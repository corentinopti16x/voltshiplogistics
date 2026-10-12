/**
 * « Corriger les SKU » (pure, unit-tested). Dropshipping stores duplicate product pages, so
 * variants end up with no SKU or with the SKU of another item. ECCANG matches each Shopify
 * order line to a warehouse product by its SKU only: such lines would not match, or would
 * match the wrong product. These helpers propose a clean SKU per variant; the admin checks
 * them and the app writes them into Shopify.
 *
 * The SKU can be printed on carrier labels and packing slips, so it stays neutral: destination
 * country + an opaque code + the option in the store's language ("US-P3X8D", "FR-H4N6T-OR").
 * Never the client's name, and never what the product is (customs).
 */

import { FALLBACK_SKU_PREFIX } from "./sku";

export type SkuFixKind = "missing" | "shared";

export type SkuFixInput = {
  key: string;
  /** Main delivery country of the store (ISO-2, "US"), or "" when unknown. */
  country: string;
  /** Same Voltship product (or same Shopify product when not linked): same item. */
  groupKey: string;
  /** Shopify option title ("Gold / 3", "Default Title"), when known. */
  variantTitle: string | null;
};

const STOPWORDS = new Set([
  "THE", "AND", "WITH", "FOR", "OF", "A", "AN", "IN", "ON", "TO", "YOUR",
  "LE", "LA", "LES", "DE", "DU", "DES", "ET", "AU", "AUX", "EN", "POUR", "UN", "UNE", "SUR", "PAR", "AVEC",
  "DER", "DIE", "DAS", "UND", "MIT", "FUR", "EL", "LOS", "LAS", "CON", "DEL", "PER", "IL",
  "FREE", "GRATUIT", "OFFERT", "NEW", "NOUVEAU",
]);

export function plainUpper(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[®™©]/g, "")
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

// No 0/O, 1/I/L: the code is read by people in the warehouse.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 5;

/** Stable opaque code of an item (same group → same code), e.g. "K7M2Q". */
export function neutralCode(groupKey: string, salt = 0) {
  let hash = 0x811c9dc5;
  for (const char of `${groupKey}#${salt}`) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    hash = Math.imul(hash ^ (i + 0x9e37), 0x01000193) >>> 0;
    out += CODE_ALPHABET[hash % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * One proposal per variant. Variants of the same item (same group, same option) get the
 * same SKU — duplicated pages then share it, which is what ECCANG needs. Each item gets its
 * own code, and proposals never reuse a SKU already used anywhere (`taken`).
 */
export function proposeSkus(inputs: SkuFixInput[], taken: Iterable<string>) {
  const used = new Set([...taken].map((sku) => sku.trim().toUpperCase()));
  const usedCodes = new Set<string>();
  for (const sku of used) {
    const match = /^(?:[A-Z]{2}-)?([A-Z0-9]{5})(?:-|$)/.exec(sku);
    if (match) usedCodes.add(match[1]);
  }
  const codeOfGroup = new Map<string, string>();
  const skuOfVariant = new Map<string, string>();
  const result = new Map<string, string>();
  const ordered = [...inputs].sort((a, b) => a.groupKey.localeCompare(b.groupKey) || a.key.localeCompare(b.key));
  for (const input of ordered) {
    let code = codeOfGroup.get(input.groupKey);
    if (!code) {
      let salt = 0;
      code = neutralCode(input.groupKey, salt);
      while (usedCodes.has(code)) code = neutralCode(input.groupKey, (salt += 1));
      usedCodes.add(code);
      codeOfGroup.set(input.groupKey, code);
    }
    const variantId = `${input.groupKey}|${normVariant(input.variantTitle)}`;
    let sku = skuOfVariant.get(variantId);
    if (!sku) {
      const country = /^[A-Z]{2}$/i.test(input.country) ? input.country.toUpperCase() : "";
      const option = isDefaultVariantTitle(input.variantTitle) ? "" : slugWords(input.variantTitle ?? "", 3, 14);
      const base = [country, code, option].filter(Boolean).join("-");
      sku = base;
      for (let n = 2; used.has(sku.toUpperCase()); n += 1) sku = `${base}-${n}`;
      used.add(sku.toUpperCase());
      skuOfVariant.set(variantId, sku);
    }
    result.set(input.key, sku);
  }
  return result;
}
