import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptShopifyToken, encryptShopifyToken } from "./crypto";
import { backfillShopifyOrders, issueShopifyAccessToken, syncShopifyProducts } from "./admin-api";
import {
  classifyLifecycle,
  parseLifecycleThresholds,
  type DailySale,
} from "@/lib/domain/lifecycle";
import type { ProductRow } from "@/lib/products/types";
import { getAirtableConfig } from "@/lib/airtable/config";
import { patchAirtableProduct } from "@/lib/airtable/products";
import { createNotification } from "@/lib/notifications/server";

export async function accessTokenForConnectedShop(shop: {
  id: string;
  shopify_domain: string;
  access_token_encrypted: string | null;
}) {
  // OAuth-connected shops hold a long-lived offline token: use it as-is. The
  // client_credentials grant is only a fallback for the legacy "installed custom app" path.
  if (shop.access_token_encrypted) return decryptShopifyToken(shop.access_token_encrypted);
  const admin = createAdminClient();
  try {
    const issued = await issueShopifyAccessToken(shop.shopify_domain);
    await admin
      .from("shops")
      .update({
        access_token_encrypted: encryptShopifyToken(issued.accessToken),
        scopes: issued.scope,
        status: "active",
      })
      .eq("id", shop.id);
    return issued.accessToken;
  } catch (error) {
    throw error instanceof Error ? error : new Error("No Shopify access token for this shop.");
  }
}

export async function syncConnectedShopifyShops() {
  const admin = createAdminClient();
  const { data: shops } = await admin
    .from("shops")
    .select("id, client_id, shopify_domain, access_token_encrypted")
    .eq("status", "active")
    .not("access_token_encrypted", "is", null);
  let synced = 0;
  const errors: string[] = [];
  for (const shop of shops ?? []) {
    try {
      const accessToken = await accessTokenForConnectedShop(shop);
      await backfillShopifyOrders({
        clientId: shop.client_id,
        shopId: shop.id,
        shop: shop.shopify_domain,
        accessToken,
      });
      await syncShopifyProducts({
        clientId: shop.client_id,
        shopId: shop.id,
        shop: shop.shopify_domain,
        accessToken,
      });
      await admin
        .from("shops")
        .update({ last_synced_at: new Date().toISOString(), sync_error: null })
        .eq("id", shop.id);
      synced += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shopify sync failed.";
      errors.push(`${shop.shopify_domain}: ${message}`);
      await admin
        .from("shops")
        .update({ sync_error: message })
        .eq("id", shop.id);
    }
  }
  return { scanned: (shops ?? []).length, synced, errors };
}

export async function classifyAllProducts() {
  const admin = createAdminClient();
  const { data: products } = await admin
    .from("products_cache")
    .select("*")
    .not("sku", "is", null);
  const clientIds = [...new Set((products ?? []).map((row) => row.client_id))];
  const thresholdMap = new Map<string, unknown>();
  if (clientIds.length > 0) {
    const { data: clients } = await admin
      .from("clients")
      .select("id, lifecycle_thresholds_json")
      .in("id", clientIds);
    for (const client of clients ?? []) {
      thresholdMap.set(client.id, client.lifecycle_thresholds_json);
    }
  }

  let changed = 0;
  for (const raw of products ?? []) {
    const product = raw as ProductRow;
    if (!product.sku) continue;
    const { data: sales } = await admin
      .from("sales_cache")
      .select("date, units_sold")
      .eq("client_id", product.client_id)
      .eq("sku", product.sku)
      .gte("date", new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10));
    const status = classifyLifecycle({
      current: product.lifecycle_status,
      createdDate: product.created_date,
      sales: (sales ?? []).map(
        (row): DailySale => ({ date: row.date, units: Number(row.units_sold) }),
      ),
      thresholds: parseLifecycleThresholds(thresholdMap.get(product.client_id)),
    });
    if (status === product.lifecycle_status) continue;

    if (
      getAirtableConfig().configured &&
      !product.airtable_record_id.startsWith("pending:")
    ) {
      await patchAirtableProduct(product.airtable_record_id, {
        lifecycleStatus: status,
      });
    }
    await admin
      .from("products_cache")
      .update({ lifecycle_status: status })
      .eq("id", product.id)
      .eq("client_id", product.client_id);
    await createNotification({
      clientId: product.client_id,
      type: "lifecycle_changed",
      channels: ["in_app", "email"],
      payload: {
        productId: product.id,
        productTitle: product.title,
        from: product.lifecycle_status,
        to: status,
        message: `${product.title} is now ${status}.`,
      },
    });
    changed += 1;
  }
  return { scanned: (products ?? []).length, changed };
}
