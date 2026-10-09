/**
 * Units sold over the last 90 days per Voltship product (pure, unit-tested), from the
 * Shopify variants cache: a variant counts for the product it was imported into, or for
 * the product of the same client carrying its SKU. Sales are counted once per SKU (two
 * pages selling the same SKU share the same sales), like « À compléter ».
 */

export type SalesVariant = {
  id: string;
  client_id: string;
  sku: string | null;
  units_90d: number | null;
  imported_product_id: string | null;
};

export type SalesProduct = { id: string; client_id: string; sku: string | null };

function norm(sku: string | null | undefined) {
  return (sku ?? "").trim().toLowerCase();
}

export function unitsSold90d(products: SalesProduct[], variants: SalesVariant[]) {
  const ids = new Set(products.map((product) => product.id));
  const bySku = new Map<string, string>();
  for (const product of products) {
    const key = norm(product.sku);
    if (key) bySku.set(`${product.client_id}|${key}`, product.id);
  }
  const perProduct = new Map<string, Map<string, number>>();
  for (const variant of variants) {
    const sku = norm(variant.sku);
    const productId =
      (variant.imported_product_id && ids.has(variant.imported_product_id) ? variant.imported_product_id : null) ??
      (sku ? bySku.get(`${variant.client_id}|${sku}`) : undefined) ??
      null;
    if (!productId) continue;
    const units = Math.max(0, Number(variant.units_90d) || 0);
    const skus = perProduct.get(productId) ?? new Map<string, number>();
    const key = sku || `variant:${variant.id}`;
    skus.set(key, Math.max(skus.get(key) ?? 0, units));
    perProduct.set(productId, skus);
  }
  const out = new Map<string, number>();
  for (const product of products) {
    const skus = perProduct.get(product.id);
    out.set(product.id, skus ? [...skus.values()].reduce((sum, value) => sum + value, 0) : 0);
  }
  return out;
}

/** Products created from a Shopify import (not a brief sent by the client). */
export function isShopifyImport(migrationState: string | null | undefined) {
  return migrationState === "imported_auto" || migrationState === "imported_pending";
}
