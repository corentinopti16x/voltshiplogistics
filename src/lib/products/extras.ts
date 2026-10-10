/**
 * Small product settings stored in `products_cache.quote_json` (no schema change):
 * - `pack_pieces`: pieces shipped per unit sold on Shopify (a "set de 2" = 2). Factory
 *   price, client price and weight are entered for the WHOLE set, so the COGS stays per
 *   Shopify unit; the warehouse (ECCANG) must pick `pack_pieces` pieces per unit sold.
 * - `client_note` / `client_note_at`: a note written by Voltship that the client sees on
 *   his product page (unlike `sourcing_work.internal_notes`, which stays internal).
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
  input: { batteryInternal: boolean; packPieces: number; clientNote: string | null },
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
    } as Record<string, unknown>,
    /** True when a new or edited note must be announced to the client. */
    noteChanged: noteChanged && input.clientNote != null,
  };
}
