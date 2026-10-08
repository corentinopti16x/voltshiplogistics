/**
 * SKU rules (pure, unit-tested). Clients reuse SKUs freely on Shopify: the same item listed
 * several times (duplicate pages, one page per shop, bundles…) and, sometimes, the same SKU
 * typed on two different items (a carrying case created with the vacuum's SKU). Voltship
 * never asks them to change anything:
 *
 *  1. Every Shopify variant gets an *effective SKU* — its own SKU, or `SHOPIFY-<variant id>`
 *     when it has none, when the admin split it, or when its SKU is also used by a clearly
 *     different item (different words in the titles) and it is not the oldest listing —
 *     then `SHOPIFY-P<oldest product id of that item>`, shared by that item's listings.
 *  2. Shopify listings (shop + product) that share an effective SKU are one Voltship product.
 */

import { FALLBACK_SKU_PREFIX, fallbackVariantSku } from "./sku";

export type SkuVariant = {
  /** Stable key of the cache row (its id). */
  key: string;
  shopId: string;
  shopifyProductId: string;
  variantId: string;
  title: string;
  /** SKU as typed on Shopify (null / blank when none). */
  rawSku: string | null;
  /** Admin "Séparer": this listing never shares its SKU. */
  split?: boolean;
};

const STOPWORDS = new Set([
  "the", "and", "with", "for", "your", "you", "our", "new", "free", "gift", "bonus", "pack", "set", "lot",
  "pcs", "piece", "pieces", "edition", "version", "offer", "offert", "offerte", "offerts", "cadeau", "gratuit",
  "gratuite", "nouveau", "nouvelle", "pour", "avec", "des", "les", "aux", "une", "sur", "par", "dans", "and",
  "mit", "und", "der", "die", "das", "für", "von", "con", "per", "del", "della", "los", "las", "para",
]);

function words(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9一-鿿]+/)
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !STOPWORDS.has(token));
}

export function normSku(sku: string | null | undefined) {
  return (sku ?? "").trim().toLowerCase();
}

function listingKey(variant: Pick<SkuVariant, "shopId" | "shopifyProductId">) {
  return `${variant.shopId}:${variant.shopifyProductId}`;
}

/**
 * Words that identify an item. Words present in most titles of the client (the brand, a
 * product line like "phéromones") say nothing about which item it is, so they are ignored.
 */
export function significantWords(titles: string[]) {
  const unique = [...new Set(titles)];
  const df = new Map<string, number>();
  for (const title of unique) for (const word of new Set(words(title))) df.set(word, (df.get(word) ?? 0) + 1);
  const common = new Set<string>();
  if (unique.length >= 8) {
    for (const [word, count] of df) if (count / unique.length > 0.2) common.add(word);
  }
  return (title: string) => new Set(words(title).filter((word) => !common.has(word)));
}

class UnionFind {
  private parent = new Map<string, string>();
  find(key: string): string {
    const parent = this.parent.get(key) ?? key;
    if (parent === key) return key;
    const root = this.find(parent);
    this.parent.set(key, root);
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

function numericOrder(a: string, b: string) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

/**
 * Effective SKU of every variant (key → SKU). A raw SKU shared by listings whose titles have
 * no identifying word in common is kept by the cluster holding the oldest listing (lowest
 * Shopify product id, the one that had the SKU first); the other clusters get their own
 * `SHOPIFY-<variant id>`.
 */
export function resolveEffectiveSkus(variants: SkuVariant[]) {
  const result = new Map<string, string | null>();
  const sig = significantWords(variants.map((variant) => variant.title));
  const bySku = new Map<string, SkuVariant[]>();
  for (const variant of variants) {
    const raw = variant.rawSku?.trim() ?? "";
    if (!raw || variant.split) {
      result.set(variant.key, fallbackVariantSku(variant.variantId));
      continue;
    }
    result.set(variant.key, raw);
    const key = normSku(raw);
    bySku.set(key, [...(bySku.get(key) ?? []), variant]);
  }

  for (const group of bySku.values()) {
    const listings = new Map<string, { title: string; productId: string; variants: SkuVariant[] }>();
    for (const variant of group) {
      const key = listingKey(variant);
      const listing = listings.get(key) ?? { title: variant.title, productId: variant.shopifyProductId, variants: [] };
      listing.variants.push(variant);
      listings.set(key, listing);
    }
    if (listings.size < 2) continue;

    // Listings whose titles share an identifying word describe the same item.
    const uf = new UnionFind();
    const entries = [...listings.entries()];
    const wordsOf = new Map(entries.map(([key, listing]) => [key, sig(listing.title)]));
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const a = wordsOf.get(entries[i][0])!;
        const b = wordsOf.get(entries[j][0])!;
        // A title without any identifying word cannot be told apart: keep it with the others.
        const shared = a.size === 0 || b.size === 0 || [...a].some((word) => b.has(word));
        if (shared) uf.union(entries[i][0], entries[j][0]);
      }
    }
    const clusters = new Map<string, Array<[string, { productId: string; variants: SkuVariant[] }]>>();
    for (const entry of entries) {
      const root = uf.find(entry[0]);
      clusters.set(root, [...(clusters.get(root) ?? []), entry]);
    }
    if (clusters.size < 2) continue;
    const ordered = [...clusters.values()].sort((a, b) => {
      const oldestA = a.map(([, l]) => l.productId).sort(numericOrder)[0];
      const oldestB = b.map(([, l]) => l.productId).sort(numericOrder)[0];
      return numericOrder(oldestA, oldestB);
    });
    // Each other item keeps its listings together under one Voltship SKU (they shared one SKU).
    for (const cluster of ordered.slice(1)) {
      const oldest = cluster.map(([, l]) => l.productId).sort(numericOrder)[0];
      for (const [, listing] of cluster) {
        for (const variant of listing.variants) result.set(variant.key, `${FALLBACK_SKU_PREFIX}P${oldest}`);
      }
    }
  }
  return result;
}

/**
 * Listings (shop:productId) that are the same Voltship product: connected through any shared
 * effective SKU. Returns one array of listing keys per product.
 */
export function groupListings(variants: Array<Pick<SkuVariant, "shopId" | "shopifyProductId"> & { sku: string | null }>) {
  const uf = new UnionFind();
  const firstBySku = new Map<string, string>();
  const listings = new Set<string>();
  for (const variant of variants) {
    const listing = listingKey(variant);
    listings.add(listing);
    uf.find(listing);
    const sku = normSku(variant.sku);
    if (!sku) continue;
    const first = firstBySku.get(sku);
    if (first) uf.union(first, listing);
    else firstBySku.set(sku, listing);
  }
  const groups = new Map<string, string[]>();
  for (const listing of listings) {
    const root = uf.find(listing);
    groups.set(root, [...(groups.get(root) ?? []), listing]);
  }
  return [...groups.values()];
}

export type ProductCandidate = {
  id: string;
  auto: boolean;
  hasData: boolean;
  createdAt: string;
};

/** Which product a group keeps: a product created by hand / quoted first, then the most complete, then the oldest. */
export function pickKeeper<T extends ProductCandidate>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) =>
      Number(a.auto) - Number(b.auto) ||
      Number(b.hasData) - Number(a.hasData) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  )[0];
}
