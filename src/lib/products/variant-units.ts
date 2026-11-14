/**
 * How many pieces of the product one Shopify variant contains (« 24 », « 4-Pack », « Set of 2 »).
 * The team can set it by hand; otherwise it is guessed from the variant name, which is stored
 * as « Option: value / Option: value » (e.g. « Pieces: 24 », « Size: M / Pack: 2 »).
 */
export const VARIANT_UNITS_MAX = 500;

const QUANTITY_OPTION = /piece|pièce|pcs|pack|qty|quantit|bundle|lot\b|count|set\b|数量|件数|套装/i;

function clamp(value: number): number | null {
  return Number.isInteger(value) && value >= 1 && value <= VARIANT_UNITS_MAX ? value : null;
}

/** Pieces read in a value that names a quantity by itself: « 4-Pack », « Set of 2 », « x3 », « Buy 2 Get 1 ». */
function unitsInValue(value: string): number | null {
  const text = value.trim();
  const buyGet = text.match(/buy\s*(\d{1,3})\s*,?\s*get\s*(\d{1,3})/i);
  if (buyGet) return clamp(Number(buyGet[1]) + Number(buyGet[2]));
  const buy = text.match(/buy\s*(\d{1,3})\b/i);
  if (buy) return clamp(Number(buy[1]));
  const after = text.match(/\b(?:pack|set|lot|box|bundle)\s*(?:of|de|x)?\s*(\d{1,3})\b/i);
  if (after) return clamp(Number(after[1]));
  const before = text.match(
    /(\d{1,3})\s*-?\s*(?:pack|packs|pcs|pc|pieces|piece|pièces|pièce|count|ct|件|个|只)(?![a-z])/i,
  );
  if (before) return clamp(Number(before[1]));
  const times = text.match(/(?:^|[\s(])x\s?(\d{1,3})\b/i) ?? text.match(/\b(\d{1,3})\s?x(?![a-z0-9])/i);
  if (times) return clamp(Number(times[1]));
  return null;
}

/** Guess from the stored variant name; 1 when nothing says otherwise. */
export function guessVariantUnits(variantTitle: string | null | undefined): number {
  const parts = String(variantTitle ?? "")
    .split(" / ")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    const colon = part.indexOf(":");
    const option = colon > 0 ? part.slice(0, colon) : "";
    const value = colon > 0 ? part.slice(colon + 1).trim() : part;
    const named = unitsInValue(value);
    if (named) return named;
    // A bare number only counts under an option that is a quantity (« Pieces: 24 », not « Size: 36 »).
    if (option && QUANTITY_OPTION.test(option)) {
      const bare = value.match(/^(\d{1,3})\b/);
      if (bare) {
        const units = clamp(Number(bare[1]));
        if (units) return units;
      }
    }
  }
  return 1;
}

/** Pieces of a variant: the value set by the team, else the guess. */
export function variantUnits(row: { pack_units?: number | null; variant_title?: string | null }): {
  units: number;
  guessed: boolean;
} {
  const set = clamp(Number(row.pack_units));
  if (row.pack_units != null && set) return { units: set, guessed: false };
  return { units: guessVariantUnits(row.variant_title), guessed: true };
}

/** « Pieces: 24 / Color: Red » from a Shopify variant and its product options. */
export function variantLabel(
  optionNames: Array<string | null | undefined>,
  values: Array<string | null | undefined>,
  fallbackTitle?: string | null,
): string | null {
  const parts: string[] = [];
  values.forEach((value, index) => {
    const text = String(value ?? "").trim();
    if (!text || text === "Default Title") return;
    const name = String(optionNames[index] ?? "").trim();
    parts.push(name && name !== "Title" ? `${name}: ${text}` : text);
  });
  if (parts.length > 0) return parts.join(" / ");
  const title = String(fallbackTitle ?? "").trim();
  return title && title !== "Default Title" ? title : null;
}
