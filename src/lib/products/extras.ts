/**
 * Small product settings stored in `products_cache.quote_json` (no schema change):
 * - `pack_pieces`: pieces shipped per unit sold on Shopify (a "set de 2" = 2). Factory
 *   price, client price and weight are entered for the WHOLE set, so the COGS stays per
 *   Shopify unit; the warehouse (ECCANG) must pick `pack_pieces` pieces per unit sold.
 * - `client_note` / `client_note_at`: a note written by Voltship that the client sees on
 *   his product page (unlike `sourcing_work.internal_notes`, which stays internal).
 * - `box_price_rmb` / `box_weight_g`: a box bought for the product (not every product has
 *   one). Its price (converted at the pricing FX rate) is billed with the product, its
 *   weight added to each unit of the parcel.
 */

export const PACK_PIECES_MAX = 50;
export const CLIENT_NOTE_MAX = 2000;

type QuoteJson = Record<string, unknown> | null | undefined;

/** Pieces per unit sold (1 = sold alone). Invalid / missing values fall back to 1. */
export function packPieces(quoteJson: QuoteJson): number {
  const raw = Number(quoteJson?.pack_pieces);
  if (!Number.isInteger(raw) || raw < 1) return 1;
  return Math.min(raw, PACK_PIECES_MAX);
}

/** Parses the form value: empty → 1, otherwise an integer between 1 and PACK_PIECES_MAX (null = invalid). */
export function parsePackPieces(raw: unknown): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return 1;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > PACK_PIECES_MAX) return null;
  return value;
}

/** Warehouse pieces to pick for `units` sold (units × pieces per set). */
export function piecesToShip(units: number, quoteJson: QuoteJson) {
  return units * packPieces(quoteJson);
}

export type ClientNote = { text: string; at: string | null };

/** Note visible by the client, or null when there is none. */
export function clientNote(quoteJson: QuoteJson): ClientNote | null {
  const text = typeof quoteJson?.client_note === "string" ? quoteJson.client_note.trim() : "";
  if (!text) return null;
  const at = typeof quoteJson?.client_note_at === "string" ? quoteJson.client_note_at : null;
  return { text, at };
}

/** Normalised note from the form (trimmed, capped); empty → null. */
export function parseClientNote(raw: unknown): string | null {
  const text = String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!text) return null;
  return text.slice(0, CLIENT_NOTE_MAX);
}

/**
 * quote_json keys written by the sourcing sheet. The note date only moves when the text
 * changes, so saving the sheet again does not make an old note look new.
 */
export function withSheetExtras(
  quoteJson: QuoteJson,
  input: {
    batteryInternal: boolean;
    packPieces: number;
    clientNote: string | null;
    /** Box bought for the product; undefined = leave the stored box untouched. */
    boxPriceRmb?: number | null;
    boxWeightG?: number | null;
  },
  now: Date = new Date(),
) {
  const base = { ...(quoteJson ?? {}) };
  const previous = clientNote(quoteJson);
  const noteChanged = (previous?.text ?? null) !== input.clientNote;
  return {
    quote: {
      ...base,
      battery_internal: input.batteryInternal,
      pack_pieces: input.packPieces,
      client_note: input.clientNote,
      client_note_at: input.clientNote ? (noteChanged ? now.toISOString() : previous?.at ?? now.toISOString()) : null,
      ...(input.boxPriceRmb !== undefined ? { box_price_rmb: input.boxPriceRmb } : {}),
      ...(input.boxWeightG !== undefined ? { box_weight_g: input.boxWeightG } : {}),
    } as Record<string, unknown>,
    /** True when a new or edited note must be announced to the client. */
    noteChanged: noteChanged && input.clientNote != null,
  };
}

export type ProductBox = { priceRmb: number; weightG: number };

function nonNegative(raw: unknown) {
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Box of the product, or null when it ships without a bought box. */
export function productBox(quoteJson: QuoteJson): ProductBox | null {
  const priceRmb = nonNegative(quoteJson?.box_price_rmb) ?? 0;
  const weightG = nonNegative(quoteJson?.box_weight_g) ?? 0;
  if (priceRmb <= 0 && weightG <= 0) return null;
  return { priceRmb, weightG };
}

/** Box price billed to the client per unit (€), at the pricing FX rate (RMB per €). */
export function boxPriceEur(box: ProductBox | null, fxRmbPerEur: number) {
  if (!box || box.priceRmb <= 0 || !(fxRmbPerEur > 0)) return 0;
  return Math.round((box.priceRmb / fxRmbPerEur) * 10_000) / 10_000;
}

/** Pricing-engine inputs for the box + packaging of a product. */
export function parcelExtras(
  quoteJson: QuoteJson,
  settings: { fx_rmb_per_eur: number; packaging_weight_g: number },
) {
  const box = productBox(quoteJson);
  return {
    boxPrice: boxPriceEur(box, settings.fx_rmb_per_eur),
    boxWeightG: box?.weightG ?? 0,
    packagingWeightG: settings.packaging_weight_g,
  };
}

/** Form values: empty → null (no box); otherwise a number ≥ 0 (NaN = invalid). */
export function parseBoxField(raw: unknown): number | null {
  const text = String(raw ?? "").trim().replace(",", ".");
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
}
