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
