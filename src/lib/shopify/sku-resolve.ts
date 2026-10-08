import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { isFallbackSku } from "./sku";
import { resolveEffectiveSkus, type SkuVariant } from "./sku-groups";

type CacheRow = {
  id: string;
  shop_id: string;
  shopify_product_id: string;
  shopify_variant_id: string;
  title: string;
  sku: string | null;
  shopify_sku: string | null;
  sku_split: boolean | null;
};

async function loadClientVariants(clientId: string) {
  const admin = createAdminClient();
  const rows: CacheRow[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await admin
      .from("shopify_products_cache")
      .select("id, shop_id, shopify_product_id, shopify_variant_id, title, sku, shopify_sku, sku_split")
      .eq("client_id", clientId)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as CacheRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/** SKU typed on Shopify (rows cached before `shopify_sku` existed: the stored SKU unless it is a fallback). */
function rawSkuOf(row: CacheRow) {
  if (row.shopify_sku != null) return row.shopify_sku.trim() || null;
  return row.sku && !isFallbackSku(row.sku) ? row.sku : null;
}

/**
 * Recomputes the effective SKU of every Shopify variant of the client (all shops at once, a
 * SKU being shared across shops) and stores the ones that changed.
 */
export async function refreshClientEffectiveSkus(clientId: string) {
  const rows = await loadClientVariants(clientId);
  const variants: SkuVariant[] = rows.map((row) => ({
    key: row.id,
    shopId: row.shop_id,
    shopifyProductId: row.shopify_product_id,
    variantId: row.shopify_variant_id,
    title: row.title,
    rawSku: rawSkuOf(row),
    split: Boolean(row.sku_split),
  }));
  const resolved = resolveEffectiveSkus(variants);
  const admin = createAdminClient();
  let changed = 0;
  for (const row of rows) {
    const next = resolved.get(row.id) ?? null;
    if (next === row.sku) continue;
    await admin.from("shopify_products_cache").update({ sku: next }).eq("id", row.id);
    changed += 1;
  }
  return { variants: rows.length, changed };
}

/** Shopify variant id → effective SKU for one shop (orders follow what the catalogue decided). */
export async function loadVariantSkuResolver(shopId: string) {
  const admin = createAdminClient();
  const map = new Map<string, string>();
  for (let from = 0; from < 50000; from += 1000) {
    const { data } = await admin
      .from("shopify_products_cache")
      .select("shopify_variant_id, sku")
      .eq("shop_id", shopId)
      .order("id")
      .range(from, from + 999);
    for (const row of data ?? []) if (row.sku) map.set(String(row.shopify_variant_id), row.sku);
    if (!data || data.length < 1000) break;
  }
  return map;
}
