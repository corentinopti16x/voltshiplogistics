/**
 * The app is the source of truth for a product that already exists in it: Airtable only
 * fills what the app does not know yet. (Before 12 Nov. 2026 a filled Airtable cell
 * overwrote the app every 10 minutes: a weight corrected in the app came back wrong.)
 */
const NEVER = new Set(["id", "client_id", "airtable_record_id", "quote_json", "photo_url"]);

function empty(value: unknown) {
  return value == null || value === "";
}

/** Columns Airtable may write on an existing product: only those still empty in the app. */
export function fillEmptyFromAirtable(
  existing: Record<string, unknown>,
  fromAirtable: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fromAirtable)) {
    if (NEVER.has(key) || empty(value)) continue;
    if (empty(existing[key])) patch[key] = value;
  }
  return patch;
}

/** quote_json: keys the app already holds win, Airtable adds the missing ones. */
export function mergeQuoteAppFirst(
  existing: Record<string, unknown>,
  fromAirtable: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...fromAirtable };
  for (const [key, value] of Object.entries(existing)) {
    if (!empty(value) || !(key in merged)) merged[key] = value;
  }
  return merged;
}
