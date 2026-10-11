import "server-only";

import { reconcileClientProducts } from "@/lib/shopify/import-product";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptShopifyToken, encryptShopifyToken } from "./crypto";
import { unpackOrderLines } from "./order-cache";
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

async function hasUnpricedRecentOrders(shopId: string) {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const { data } = await admin
    .from("shopify_orders_cache")
    .select("line_items_json")
    .eq("shop_id", shopId)
    .gte("order_date", since)
    .order("order_date", { ascending: true })
    .limit(200);
  return (data ?? []).some((row) => unpackOrderLines(row.line_items_json).total == null);
}

/** Runs `task` over `items`, `limit` at a time. */
async function eachWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Clients synced at the same time. The shops of one client stay one after the other (they
 * share its products and SKU maps); each shop has its own Shopify API limits.
 */
const CLIENT_SYNC_CONCURRENCY = 3;

export async function syncConnectedShopifyShops(options: { days?: number } = {}) {
  const admin = createAdminClient();
  const { data: shops } = await admin
    .from("shops")
    .select("id, client_id, shopify_domain, access_token_encrypted")
    .eq("status", "active")
    .not("access_token_encrypted", "is", null);
  let synced = 0;
  const errors: string[] = [];
  const byClient = new Map<string, NonNullable<typeof shops>>();
  for (const shop of shops ?? []) byClient.set(shop.client_id, [...(byClient.get(shop.client_id) ?? []), shop]);
  await eachWithConcurrency([...byClient.values()], CLIENT_SYNC_CONCURRENCY, async (clientShops) => {
    for (const shop of clientShops) await syncOneShop(shop);
  });
  return { scanned: (shops ?? []).length, synced, errors };

  async function syncOneShop(shop: NonNullable<typeof shops>[number]) {
    try {
      const accessToken = await accessTokenForConnectedShop(shop);
      // Light refresh, unless orders of the last 30 days still lack their price (cached
      // before prices were stored): then rebuild the full 90 days once.
      let days = options.days;
      if (days != null && days < 90 && (await hasUnpricedRecentOrders(shop.id))) days = 90;
      await backfillShopifyOrders({
        clientId: shop.client_id,
        shopId: shop.id,
        shop: shop.shopify_domain,
        accessToken,
        days,
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
}

/** Every row of a query, 1000 at a time (PostgREST caps a response at 1000 rows). */
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>) {
  const rows: T[] = [];
  for (let from = 0; from < 500_000; from += 1000) {
    const { data } = await page(from, from + 999);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export async function classifyAllProducts() {
  const admin = createAdminClient();
  const products = await allRows<ProductRow>((from, to) =>
    admin.from("products_cache").select("*").neq("lifecycle_status", "archived").order("id").range(from, to),
  );
  const clientIds = [...new Set(products.map((row) => row.client_id))];
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

  // SKU maps and the last 120 days of sales of every client, loaded once (one query per
  // product made the job too slow for the cron).
  const since = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const mappedSkus = new Map<string, string[]>();
  const salesBySku = new Map<string, Array<{ date: string; units: number }>>();
  for (const clientId of clientIds) {
    const maps = await allRows<{ airtable_record_id: string | null; shopify_sku: string | null }>((from, to) =>
      admin
        .from("sku_maps")
        .select("airtable_record_id, shopify_sku")
        .eq("client_id", clientId)
        .order("id")
        .range(from, to),
    );
    for (const row of maps) {
      if (!row.airtable_record_id || !row.shopify_sku) continue;
      const key = `${clientId}|${row.airtable_record_id}`;
      mappedSkus.set(key, [...(mappedSkus.get(key) ?? []), row.shopify_sku]);
    }
    const sales = await allRows<{ sku: string; date: string; units_sold: number }>((from, to) =>
      admin
        .from("sales_cache")
        .select("sku, date, units_sold")
        .eq("client_id", clientId)
        .gte("date", since)
        .order("id")
        .range(from, to),
    );
    for (const row of sales) {
      const key = `${clientId}|${row.sku}`;
      salesBySku.set(key, [...(salesBySku.get(key) ?? []), { date: row.date, units: Number(row.units_sold) }]);
    }
  }

  let changed = 0;
  for (const product of products) {
    // A product imported from Shopify has no SKU of its own: every variant SKU is mapped to
    // it in sku_maps. Count them all; skip products with no SKU at all (new requests).
    const skus = [
      ...new Set(
        [product.sku, ...(mappedSkus.get(`${product.client_id}|${product.airtable_record_id}`) ?? [])].filter(
          (sku): sku is string => Boolean(sku),
        ),
      ),
    ];
    if (skus.length === 0) continue;
    const byDate = new Map<string, number>();
    for (const sku of skus) {
      for (const row of salesBySku.get(`${product.client_id}|${sku}`) ?? []) {
        byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.units);
      }
    }
    const classified = classifyLifecycle({
      current: product.lifecycle_status,
      createdDate: product.created_date,
      sales: [...byDate.entries()].map(
        ([date, units]): DailySale => ({ date, units }),
      ),
      thresholds: parseLifecycleThresholds(thresholdMap.get(product.client_id)),
    });
    // Migrated products were already selling on the client's store: they are winners
    // unless sales actually drop (declining/dead), never back to testing.
    // Manual imports were chosen because they sell; automatic ones follow their real sales.
    const autoImported = product.migration_state === "imported_auto";
    const migrated = (product.migration_state ?? "").startsWith("imported") && !autoImported;
    const status = migrated && classified === "testing" ? "winning" : classified;
    if (status === product.lifecycle_status) continue;

    if (
      getAirtableConfig().configured &&
      !product.airtable_record_id.startsWith("pending:")
    ) {
      // Airtable is only a mirror: a failed push must not stop the classification.
      await patchAirtableProduct(product.airtable_record_id, {
        lifecycleStatus: status,
      }).catch(() => null);
    }
    await admin
      .from("products_cache")
      .update({ lifecycle_status: status })
      .eq("id", product.id)
      .eq("client_id", product.client_id);
    // No notification for the first classification of a freshly auto-imported product
    // (a store connection would otherwise send one message per product).
    const fresh = autoImported && Date.now() - Date.parse(product.created_at) < 3 * 86400000;
    if (fresh) {
      changed += 1;
      continue;
    }
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
  return { scanned: products.length, changed };
}

/**
 * One Voltship product per real item, across all the shops of each client (own cron, so a
 * long Shopify sync can never cut it off).
 */
export async function reconcileAllClients() {
  const admin = createAdminClient();
  const { data: shops } = await admin.from("shops").select("client_id").eq("status", "active");
  const results: Record<string, unknown> = {};
  for (const clientId of new Set((shops ?? []).map((shop) => shop.client_id as string))) {
    try {
      results[clientId] = await reconcileClientProducts({ clientId });
    } catch (error) {
      results[clientId] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return results;
}
