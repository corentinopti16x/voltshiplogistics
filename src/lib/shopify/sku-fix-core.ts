/**
 * « Corriger les SKU » (pure, unit-tested). Dropshipping stores duplicate product pages, so
 * variants end up with no SKU or with the SKU of another item. ECCANG matches each Shopify
 * order line to a warehouse product by its SKU only: such lines would not match, or would
 * match the wrong product. These helpers propose a clean SKU per variant; the admin checks
 * them and the app writes them into Shopify.
 *
 * The SKU stays internal (carriers replace the label before the last mile and declare the
 * product under its customs name), so it is readable: destination country + product in clear
 * + option number ("FR-MAGNESIUM-COMPLEX-01", "FR-BRACELETS-02"). Never the client's name nor
 * the brand: the product's Shopify vendor, the client's name/code and words marked ®/™ are left out.
 */

import { FALLBACK_SKU_PREFIX } from "./sku";

export type SkuFixKind = "missing" | "shared";

export type SkuFixInput = {
  key: string;
  /** Main delivery country of the store (ISO-2, "US"), or "" when unknown. */
  country: string;
  /** Same Voltship product (or same Shopify product when not linked): same item. */
  groupKey: string;
  /** Product title as sold in the store. */
  productTitle: string;
  /** Words to leave out: brand (Shopify vendor), client name and code. */
  brands?: Array<string | null | undefined>;
  /** Shopify option title ("Gold / 3", "Default Title"), when known. */
  variantTitle: string | null;
};

/** A SKU already in use, and the item (group) that owns it when known. */
export type TakenSku = { sku: string; owner: string | null };

const STOPWORDS = new Set([
  "THE", "AND", "WITH", "FOR", "OF", "A", "AN", "IN", "ON", "TO", "YOUR",
  "LE", "LA", "LES", "DE", "DU", "DES", "ET", "AU", "AUX", "EN", "POUR", "UN", "UNE", "SUR", "PAR", "AVEC",
  "DER", "DIE", "DAS", "UND", "MIT", "FUR", "EL", "LOS", "LAS", "CON", "DEL", "PER", "IL",
  "FREE", "GRATUIT", "OFFERT", "NEW", "NOUVEAU",
]);

/** Marketing words that say nothing about the item: skipped in product SKUs. */
const NOISE = new Set([
  "PREMIUM", "ORGANIC", "BIO", "DIY", "SMART", "BEST", "SUPER", "ULTRA", "PRO", "MAX", "PLUS",
  "ENSEMBLE", "SET", "KIT", "PACK", "LOT", "COFFRET", "BUNDLE",
  "PERSONALIZED", "PERSONALISED", "CUSTOM", "PERSONNALISE", "PERSONNALISES", "PERSONNALISEE", "PERSONNALISEES",
]);

/** Words to leave out of SKUs: every word of the brand / client names given. */
export function brandWords(names: Array<string | null | undefined>) {
  const out = new Set<string>();
  for (const name of names) {
    for (const part of plainUpper(name ?? "").split(/[^A-Z0-9]+/)) if (part.length >= 2) out.add(part);
  }
  return out;
}

/**
 * Significant words of a product title, uppercase ASCII: no brand (words marked ®/™/© and the
 * `brands` given), no stopwords, no marketing words, no lone numbers.
 */
export function productWords(title: string, brands: Iterable<string> = []) {
  const skip = new Set(brands);
  for (const match of title.matchAll(/([\p{L}\p{N}]+)\s*[®™©]/gu)) skip.add(plainUpper(match[1]));
  const all = plainUpper(title)
    .split(/[^A-Z0-9]+/)
    .filter((part) => part && !STOPWORDS.has(part) && !/^\d+$/.test(part) && !skip.has(part));
  const words = all.filter((part) => !NOISE.has(part));
  return words.length > 0 ? words : all;
}

export function plainUpper(text: string) {
  return text
    .replace(/[®™©]/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

/** First `words` significant words, uppercase ASCII, dash-joined, at most `max` characters. */
export function slugWords(text: string, words: number, max: number) {
  const parts = plainUpper(text)
    .split(/[^A-Z0-9]+/)
    .filter((part) => part && !STOPWORDS.has(part));
  let out = "";
  for (const part of parts.slice(0, words)) {
    const next = out ? `${out}-${part}` : part;
    if (next.length > max) {
      if (!out) out = part.slice(0, max);
      break;
    }
    out = next;
  }
  return out;
}

export function isDefaultVariantTitle(title: string | null | undefined) {
  const text = (title ?? "").trim().toLowerCase();
  return !text || text === "default title" || text === "default";
}

const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/+]{0,63}$/;

/** Error message key when the SKU cannot be written, else null. */
export function skuError(sku: string) {
  const value = sku.trim();
  if (!value) return "empty";
  if (value.toUpperCase().startsWith(FALLBACK_SKU_PREFIX)) return "reserved";
  if (!SKU_PATTERN.test(value)) return "format";
  return null;
}

function normVariant(title: string | null) {
  return isDefaultVariantTitle(title) ? "" : plainUpper(title ?? "").replace(/[^A-Z0-9]+/g, " ").trim();
}

/** Order lines that are not goods (shipping insurance, free shipping…): not ticked by default. */
export function isServiceLine(title: string) {
  return /\b(assurance|insurance|livraison|shipping|delivery|frais de port|pourboire|garantie|warranty|(package|order|parcel) protection)\b/i.test(
    plainUpper(title).toLowerCase(),
  );
}

const PRODUCT_MAX = 24;

/** `FR-MAGNESIUM-COMPLEX-01` uses the name `FR-MAGNESIUM-COMPLEX` (not `FR-MAGNESIUM`). */
function ownsPrefix(sku: string, prefix: string) {
  return sku === prefix || (sku.startsWith(`${prefix}-`) && /^\d+$/.test(sku.slice(prefix.length + 1)));
}

function productPart(words: string[], count: number) {
  let out = "";
  for (const word of words.slice(0, count)) {
    const next = out ? `${out}-${word}` : word;
    if (next.length > PRODUCT_MAX) {
      if (!out) out = word.slice(0, PRODUCT_MAX);
      break;
    }
    out = next;
  }
  return out || "ITEM";
}

/**
 * One proposal per variant: `COUNTRY-PRODUCT-NN`. The product part is the shortest readable
 * name (2 significant words, more on a clash) that no other item already uses; NN numbers
 * the options of the item (01 when there is none). Variants of the same item with the same
 * option get the same SKU, so duplicated pages share it, which is what ECCANG needs.
 */
export function proposeSkus(inputs: SkuFixInput[], taken: TakenSku[]) {
  const takenList = taken.map((entry) => ({ sku: entry.sku.trim().toUpperCase(), owner: entry.owner }));
  const usedSkus = new Set(takenList.map((entry) => entry.sku));
  const prefixOwner = new Map<string, string>();
  const clashes = (prefix: string, groupKey: string) => {
    const owner = prefixOwner.get(prefix);
    if (owner && owner !== groupKey) return true;
    return takenList.some((entry) => entry.owner !== groupKey && ownsPrefix(entry.sku, prefix));
  };

  const byGroup = new Map<string, SkuFixInput[]>();
  for (const input of [...inputs].sort((a, b) => a.key.localeCompare(b.key))) {
    byGroup.set(input.groupKey, [...(byGroup.get(input.groupKey) ?? []), input]);
  }

  const result = new Map<string, string>();
  for (const groupKey of [...byGroup.keys()].sort()) {
    const group = byGroup.get(groupKey)!;
    const first = group[0];
    const country = /^[A-Z]{2}$/i.test(first.country) ? first.country.toUpperCase() : "";
    const words = productWords(first.productTitle, brandWords(first.brands ?? []));
    let prefix = "";
    for (let count = 2; count <= Math.max(2, words.length) && !prefix; count += 1) {
      const candidate = [country, productPart(words, count)].filter(Boolean).join("-");
      if (!clashes(candidate, groupKey)) prefix = candidate;
    }
    if (!prefix) {
      const base = [country, productPart(words, 2)].filter(Boolean).join("-");
      for (let n = 2; !prefix; n += 1) if (!clashes(`${base}${n}`, groupKey)) prefix = `${base}${n}`;
    }
    prefixOwner.set(prefix, groupKey);

    // Option numbers: no option first, then options in alphabetical order; skip numbers in use.
    const options = [...new Set(group.map((input) => normVariant(input.variantTitle)))].sort((a, b) =>
      a === "" ? -1 : b === "" ? 1 : a.localeCompare(b),
    );
    const skuOfOption = new Map<string, string>();
    // A single-option item already written elsewhere (duplicated page): reuse its SKU.
    const own = takenList.find((entry) => entry.owner === groupKey && ownsPrefix(entry.sku, prefix) && entry.sku !== prefix);
    if (options.length === 1 && own) {
      for (const input of group) result.set(input.key, own.sku);
      continue;
    }
    let n = 1;
    for (const option of options) {
      let sku = `${prefix}-${String(n).padStart(2, "0")}`;
      while (usedSkus.has(sku.toUpperCase())) {
        n += 1;
        sku = `${prefix}-${String(n).padStart(2, "0")}`;
      }
      usedSkus.add(sku.toUpperCase());
      skuOfOption.set(option, sku);
      n += 1;
    }
    for (const input of group) result.set(input.key, skuOfOption.get(normVariant(input.variantTitle))!);
  }
  return result;
}
