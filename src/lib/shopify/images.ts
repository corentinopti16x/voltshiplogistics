import "server-only";

import type { ProductRow } from "@/lib/products/types";
import { parseImagesJson } from "@/lib/shopify/order-cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Shopify images (hot-linked URLs from shopify_products_cache.images_json) for each
 * product that is linked to a Shopify variant. The link is resolved in this order:
 * 1. shopify_products_cache.imported_product_id = product.id (admin import),
 * 2. shopify_products_cache.sku = product.sku (the SKU the admin import also writes
 *    to sku_maps.shopify_sku).
 * Products without a link get no entry, so callers fall back to the uploaded photo.
 */
export async function loadShopifyImagesForProducts(
  clientId: string,
  products: ProductRow[],
): Promise<Map<string, string[]>> {
  const images = new Map<string, string[]>();
  if (products.length === 0) return images;

  const admin = createAdminClient();
  const { data: cache } = await admin
    .from("shopify_products_cache")
    .select("sku, imported_product_id, images_json, photo_url")
    .eq("client_id", clientId);

  const byImportedId = new Map<string, string[]>();
  const bySku = new Map<string, string[]>();
  for (const row of cache ?? []) {
    const urls = parseImagesJson(row.images_json);
    if (urls.length === 0 && typeof row.photo_url === "string" && row.photo_url) {
      urls.push(row.photo_url);
    }
    if (urls.length === 0) continue;
    if (row.imported_product_id && !byImportedId.has(row.imported_product_id)) {
      byImportedId.set(row.imported_product_id, urls);
    }
    if (row.sku && !bySku.has(row.sku)) bySku.set(row.sku, urls);
  }

  for (const product of products) {
    const direct = byImportedId.get(product.id);
    if (direct) {
      images.set(product.id, direct);
      continue;
    }
    const viaSku = product.sku ? bySku.get(product.sku) : undefined;
    if (viaSku) images.set(product.id, viaSku);
  }
  return images;
}
