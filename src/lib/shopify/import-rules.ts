/** Pure rules of the Shopify → Voltship product import (no I/O, unit-tested). */

/** Days an automatic, still empty product is kept before it can be archived as dormant. */
export const DORMANT_GRACE_DAYS = 14;

/** True when at least one of these Shopify variants sold over the last 90 days. */
export function soldRecently(variants: ReadonlyArray<{ units_90d?: number | null }>) {
  return variants.some((variant) => Number(variant.units_90d ?? 0) > 0);
}

/**
 * Photo to put on a product whose Shopify photo is gone: a photo taken from Shopify that none
 * of its live listings uses any more is replaced by the one of its best-selling listing.
 * Null = keep the current photo (still used, or not a Shopify photo: uploaded by the team).
 */
export function refreshedShopifyPhoto(
  current: string | null | undefined,
  listings: ReadonlyArray<{ photo_url?: string | null; units_90d?: number | null }>,
): string | null {
  const photos = listings.filter((listing) => listing.photo_url);
  if (photos.length === 0) return null;
  if (current && !current.includes("cdn.shopify.com")) return null;
  if (current && photos.some((listing) => listing.photo_url === current)) return null;
  const best = [...photos].sort((a, b) => Number(b.units_90d ?? 0) - Number(a.units_90d ?? 0))[0];
  return best.photo_url ?? null;
}
