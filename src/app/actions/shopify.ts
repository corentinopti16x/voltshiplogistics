"use server";

import { autoImportShopProducts } from "@/lib/shopify/import-product";
import { formatShopMarkets } from "@/lib/shopify/shop-markets";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { importShopifyVariantGroup } from "@/lib/shopify/import-product";
import {
  backfillShopifyOrders,
  syncShopifyProducts,
} from "@/lib/shopify/admin-api";
import { accessTokenForConnectedShop } from "@/lib/shopify/sync";
import type { ActionResult } from "@/app/actions/admin";

async function requireAdmin() {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "voltship_admin") {
    return { ctx: null, error: "Admin access required." };
  }
  return { ctx, error: null };
}

export async function syncShopAction(shopId: string): Promise<void> {
  const { ctx } = await requireAdmin();
  if (!ctx) throw new Error("Admin access required.");
  const admin = createAdminClient();
  const { data: shop } = await admin
    .from("shops")
    .select("id, client_id, shopify_domain, access_token_encrypted")
    .eq("id", shopId)
    .maybeSingle();
  if (!shop?.access_token_encrypted) throw new Error("Connected shop not found.");
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
    await autoImportShopProducts({ clientId: shop.client_id, shopId: shop.id }).catch(() => null);
    await admin
      .from("shops")
      .update({ last_synced_at: new Date().toISOString(), sync_error: null })
      .eq("id", shop.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify sync failed.";
    await admin.from("shops").update({ sync_error: message }).eq("id", shop.id);
    throw error;
  }
  revalidatePath("/admin");
  revalidatePath("/admin/shops");
}

export async function disconnectShopAdminAction(shopId: string): Promise<void> {
  const { ctx } = await requireAdmin();
  if (!ctx) throw new Error("Admin access required.");
  const admin = createAdminClient();
  const { error } = await admin
    .from("shops")
    .update({ status: "disconnected", access_token_encrypted: null, sync_error: null })
    .eq("id", shopId);
  if (error) throw error;
  revalidatePath("/admin");
  revalidatePath("/admin/shops");
}

export async function importShopifyProductsAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error: error ?? "Admin access required." };
  const ids = formData.getAll("product_ids").map(String).filter(Boolean);
  if (ids.length === 0) return { ok: false, error: "Select at least one product." };

  const admin = createAdminClient();
  const { data: rows, error: readError } = await admin
    .from("shopify_products_cache")
    .select("*, clients!inner(name, airtable_client_record_id)")
    .in("id", ids)
    .is("imported_product_id", null);
  if (readError) return { ok: false, error: readError.message };

  // One Voltship product per Shopify product: all selected variants of the same
  // product are imported together and each variant SKU is mapped to it.
  type CacheRow = NonNullable<typeof rows>[number];
  const groups = new Map<string, CacheRow[]>();
  for (const row of rows ?? []) {
    const key = `${row.shop_id}:${row.shopify_product_id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  let imported = 0;
  for (const variants of groups.values()) {
    const result = await importShopifyVariantGroup(variants);
    if (!result.ok) return { ok: false, error: result.error };
    imported += 1;
  }

  revalidatePath("/admin");
  revalidatePath("/admin/shops");
  revalidatePath("/sourcer");
  return { ok: true, clientId: String(imported) };
}

/**
 * Saves the Shopify custom app (client ID + secret) dedicated to one merchant store.
 * Used by the OAuth connect/callback and webhooks for that store instead of the global app.
 */
export async function saveShopifyAppCredentialsAction(formData: FormData): Promise<void> {
  const { ctx } = await requireAdmin();
  if (!ctx) throw new Error("Admin access required.");
  const { normalizeShopDomain } = await import("@/lib/shopify/auth");
  const { encryptShopifyToken } = await import("@/lib/shopify/crypto");
  const shop = normalizeShopDomain(String(formData.get("shop") ?? ""));
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const apiSecret = String(formData.get("api_secret") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || null;
  const clientId = String(formData.get("client_id") ?? "").trim() || null;
  if (!shop) throw new Error("Domaine myshopify.com invalide.");
  const admin = createAdminClient();
  // Only re-assigning the client of an already registered store: keep its app keys.
  if (!apiKey && !apiSecret) {
    const { error } = await admin
      .from("shopify_app_credentials")
      .update({ client_id: clientId, ...(label ? { label } : {}), updated_at: new Date().toISOString() })
      .eq("shopify_domain", shop);
    if (error) throw new Error(error.message);
    revalidatePath("/admin/shops");
    return;
  }
  if (!/^[a-f0-9]{32}$/i.test(apiKey)) throw new Error("ID client Shopify invalide.");
  if (apiSecret.length < 16) throw new Error("Secret client Shopify invalide.");
  const { error } = await admin.from("shopify_app_credentials").upsert(
    {
      shopify_domain: shop,
      api_key: apiKey,
      api_secret_encrypted: encryptShopifyToken(apiSecret),
      label,
      ...(clientId ? { client_id: clientId } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "shopify_domain" },
  );
  if (error) throw new Error(error.message);
  revalidatePath("/admin/shops");
}

/**
 * Delivery country of a store. Products imported from it (not edited by hand) are moved to
 * that market so their COGS, quotes and margins use the right grid.
 */
export async function setShopMarketAction(shopId: string, formData: FormData): Promise<void> {
  const { ctx } = await requireAdmin();
  if (!ctx) throw new Error("Admin access required.");
  const main = String(formData.get("market") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(main)) throw new Error("Pays invalide.");
  // Main country + every other country the store also ships to (e.g. FR + BE, CH, LU).
  const market = formatShopMarkets(
    main,
    formData.getAll("extra").map((value) => String(value)),
  );
  const admin = createAdminClient();
  const { error } = await admin.from("shops").update({ market }).eq("id", shopId);
  if (error) throw new Error(error.message);
  const { data: links } = await admin
    .from("shopify_products_cache")
    .select("imported_product_id")
    .eq("shop_id", shopId)
    .not("imported_product_id", "is", null);
  const ids = [...new Set((links ?? []).map((row) => row.imported_product_id as string))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: products } = await admin
      .from("products_cache")
      .select("id, quote_json, migration_state")
      .in("id", ids.slice(i, i + 200));
    for (const product of products ?? []) {
      if (product.migration_state !== "imported_auto" && product.migration_state !== "imported_pending") continue;
      const quote = (product.quote_json ?? {}) as Record<string, unknown>;
      const request = (quote._request && typeof quote._request === "object" ? quote._request : {}) as Record<string, unknown>;
      if (request.destination_markets === market && !quote.destination) continue;
      const { destination: _old, ...rest } = quote;
      void _old;
      await admin
        .from("products_cache")
        .update({ quote_json: { ...rest, _request: { ...request, destination_markets: market } } })
        .eq("id", product.id);
    }
  }
  revalidatePath("/admin/shops");
  revalidatePath("/[locale]/admin/margin", "layout");
}
