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

/** SKUs (lower-cased) of each product: its own SKU + the SKUs of the Shopify variants linked to it. */
export function productSkuKeys(products: SalesProduct[], variants: SalesVariant[]) {
  const ids = new Set(products.map((product) => product.id));
  const bySku = new Map<string, string>();
  const out = new Map<string, Set<string>>();
  for (const product of products) {
    const key = norm(product.sku);
    out.set(product.id, new Set(key ? [key] : []));
    if (key) bySku.set(`${product.client_id}|${key}`, product.id);
  }
  for (const variant of variants) {
    const sku = norm(variant.sku);
    if (!sku) continue;
    const productId =
      (variant.imported_product_id && ids.has(variant.imported_product_id) ? variant.imported_product_id : null) ??
      bySku.get(`${variant.client_id}|${sku}`) ??
      null;
    if (productId) out.get(productId)!.add(sku);
  }
  return out;
}

export type SalesTrend = { last7: number; previous7: number; pct: number | null; isNew: boolean };

/**
 * Units of the last 7 days (today included) vs the 7 days before, per product, from the
 * daily sales cache (client + SKU + date). `pct` is null when there is nothing to compare.
 */
export function sevenDayTrends(
  products: SalesProduct[],
  skuKeys: Map<string, Set<string>>,
  daily: Array<{ client_id: string; sku: string; date: string; units_sold: number | null }>,
  today: string,
) {
  const dayMs = 86_400_000;
  const t0 = Date.parse(`${today}T00:00:00Z`);
  const totals = new Map<string, { last: number; prev: number }>();
  for (const row of daily) {
    const age = Math.round((t0 - Date.parse(`${row.date}T00:00:00Z`)) / dayMs);
    if (age < 0 || age > 13) continue;
    const key = `${row.client_id}|${norm(row.sku)}`;
    const entry = totals.get(key) ?? { last: 0, prev: 0 };
    if (age <= 6) entry.last += Math.max(0, Number(row.units_sold) || 0);
    else entry.prev += Math.max(0, Number(row.units_sold) || 0);
    totals.set(key, entry);
  }
  const out = new Map<string, SalesTrend>();
  for (const product of products) {
    let last7 = 0;
    let previous7 = 0;
    for (const sku of skuKeys.get(product.id) ?? []) {
      const entry = totals.get(`${product.client_id}|${sku}`);
      if (!entry) continue;
      last7 += entry.last;
      previous7 += entry.prev;
    }
    out.set(product.id, {
      last7,
      previous7,
      pct: previous7 > 0 ? Math.round(((last7 - previous7) / previous7) * 100) : null,
      isNew: previous7 === 0 && last7 > 0,
    });
  }
  return out;
}
