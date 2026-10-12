/**
 * « Corriger les SKU » (pure, unit-tested). Dropshipping stores duplicate product pages, so
 * variants end up with no SKU or with the SKU of another item. ECCANG matches each Shopify
 * order line to a warehouse product by its SKU only: such lines would not match, or would
 * match the wrong product. These helpers propose a clean SKU per variant; the admin checks
 * them and the app writes them into Shopify.
 */

import { FALLBACK_SKU_PREFIX } from "./sku";

export type SkuFixKind = "missing" | "shared";

export type SkuFixInput = {
  key: string;
  clientCode: string;
  /** Same Voltship product (or same Shopify product when not linked): same item. */
  groupKey: string;
  productTitle: string;
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

/** Short uppercase code of a client, used as SKU prefix ("Maxime" → "MAX"). */
export function clientSkuCode(code: string | null | undefined, name: string) {
  const own = plainUpper(code ?? "").replace(/[^A-Z0-9]/g, "");
  if (own) return own.slice(0, 6);
  const fromName = plainUpper(name).replace(/[^A-Z0-9]/g, "");
  return (fromName || "CLI").slice(0, 3);
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

/**
 * One proposal per variant. Variants of the same item (same group, same option) get the
 * same SKU — duplicated pages then share it, which is what ECCANG needs. Proposals never
 * reuse a SKU already used in the client's catalogue (`taken`, uppercase) by another item.
 */
export function proposeSkus(inputs: SkuFixInput[], taken: Iterable<string>) {
  const used = new Set([...taken].map((sku) => sku.trim().toUpperCase()));
  const byGroup = new Map<string, string>();
  const result = new Map<string, string>();
  const ordered = [...inputs].sort((a, b) => a.groupKey.localeCompare(b.groupKey) || a.key.localeCompare(b.key));
  for (const input of ordered) {
    const groupId = `${input.groupKey}|${normVariant(input.variantTitle)}`;
    let sku = byGroup.get(groupId);
    if (!sku) {
      const product = slugWords(input.productTitle, 3, 20) || "ITEM";
      const variant = isDefaultVariantTitle(input.variantTitle) ? "" : slugWords(input.variantTitle ?? "", 3, 14);
      const base = [input.clientCode, product, variant].filter(Boolean).join("-");
      sku = base;
      for (let n = 2; used.has(sku.toUpperCase()); n += 1) sku = `${base}-${n}`;
      used.add(sku.toUpperCase());
      byGroup.set(groupId, sku);
    }
    result.set(input.key, sku);
  }
  return result;
}
