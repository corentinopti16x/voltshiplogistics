/**
 * Pieces per Shopify variant when one product is sold in sets (LNG-WSTRAW-1 / -2 / -4,
 * « 15 bags » / « 30 bags »…). The purchase price and the weight of a product are those of
 * ONE piece; a variant of 4 costs 4 × the piece. Pure, unit-tested.
 */
import { guessVariantUnits, VARIANT_UNITS_MAX } from "./variant-units";

export type PieceVariant = {
  sku: string | null;
  variantTitle: string | null;
  /** Set by the team; null = guessed. */
  packUnits: number | null;
};

export type VariantPieces = {
  sku: string;
  pieces: number;
  /** True when nobody confirmed the number (read in the name or the SKU). */
  guessed: boolean;
};

const SUFFIX = /^(.*?)[-_](\d{1,3})$/;

/**
 * Number at the end of the SKU, counted only when the variants of the product share the same
 * root and differ by that number (LNG-WSTRAW-1 / -2 / -4). A lone « SHOE-36 » is a size, not a set.
 */
export function suffixPieces(skus: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const parsed = skus
    .map((sku) => ({ sku, match: sku.trim().match(SUFFIX) }))
    .filter((row): row is { sku: string; match: RegExpMatchArray } => row.match != null);
  const roots = new Map<string, Array<{ sku: string; n: number }>>();
  for (const { sku, match } of parsed) {
    const root = match[1].toLowerCase();
    const list = roots.get(root) ?? [];
    list.push({ sku, n: Number(match[2]) });
    roots.set(root, list);
  }
  for (const list of roots.values()) {
    const values = new Set(list.map((row) => row.n));
    if (values.size < 2) continue;
    // Sizes (36, 38, 40…) are not sets: keep small counts that include 1 or 2.
    if (![...values].every((n) => n >= 1 && n <= 50) || !(values.has(1) || values.has(2))) continue;
    for (const row of list) out.set(row.sku, row.n);
  }
  return out;
}

/** Pieces of every variant of ONE product; `productPieces` = the product's own « pieces per set ». */
export function variantPieces(variants: PieceVariant[], productPieces = 1): VariantPieces[] {
  const withSku = variants.filter((v) => (v.sku ?? "").trim());
  const fromSuffix = suffixPieces(withSku.map((v) => v.sku!.trim()));
  const rows = withSku.map((v) => {
    const sku = v.sku!.trim();
    const set = Number(v.packUnits);
    if (v.packUnits != null && Number.isInteger(set) && set >= 1 && set <= VARIANT_UNITS_MAX) {
      return { sku, pieces: set, guessed: false };
    }
    const byName = guessVariantUnits(v.variantTitle);
    const pieces = byName > 1 ? byName : fromSuffix.get(sku) ?? 1;
    return { sku, pieces, guessed: true };
  });
  const isSetProduct = rows.some((row) => row.pieces > 1 || !row.guessed);
  if (isSetProduct) return rows;
  // No variant says it is a set: the product's own setting applies to all of them.
  return rows.map((row) => ({ ...row, pieces: Math.max(1, productPieces) }));
}

/**
 * A product sold in several quantities whose numbers nobody confirmed: its COGS may be wrong.
 * True when variants carry different guessed numbers and none was set by the team.
 */
export function needsSetCheck(rows: VariantPieces[]): boolean {
  if (rows.length < 2 || rows.some((row) => !row.guessed)) return false;
  return new Set(rows.map((row) => row.pieces)).size > 1;
}
