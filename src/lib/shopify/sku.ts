/**
 * Many Shopify stores (dropshipping especially) leave the variant SKU empty. Every Voltship
 * figure (sales, stock, margins, imports) is keyed by SKU, so a variant without one gets a
 * stable fallback built from its Shopify variant id: `SHOPIFY-<variant id>`.
 */
export const FALLBACK_SKU_PREFIX = "SHOPIFY-";

export function fallbackVariantSku(variantId: string | number | null | undefined) {
  const id = String(variantId ?? "").trim();
  return id ? `${FALLBACK_SKU_PREFIX}${id}` : null;
}

/** The variant's own SKU, else the fallback from its variant id, else null. */
export function effectiveSku(
  sku: string | null | undefined,
  variantId: string | number | null | undefined,
) {
  return sku?.trim() || fallbackVariantSku(variantId);
}

export function isFallbackSku(sku: string | null | undefined) {
  return (sku ?? "").startsWith(FALLBACK_SKU_PREFIX);
}

/** Shopify variant id → effective SKU decided from the catalogue (see sku-groups.ts). */
export type SkuResolver = Map<string, string>;

/** Effective SKU of an order line: the catalogue's decision for its variant, else its own SKU / fallback. */
export function lineSku(
  line: { sku: string | null; variant_id?: string | number | null },
  resolver?: SkuResolver | null,
) {
  const variantId = line.variant_id == null ? "" : String(line.variant_id);
  return (variantId && resolver?.get(variantId)) || effectiveSku(line.sku, line.variant_id);
}
