/**
 * Per-gram prices of gram-exact grids (`rate_grid_cells.gram_prices` / `gram_costs_rmb`,
 * migration 00022). Loaders ask for them and fall back to the flat bracket price when the
 * columns do not exist yet, so a deploy before the migration keeps working.
 */
export const GRAM_COLUMNS = "gram_prices, gram_costs_rmb";

export function isMissingGramColumns(error: { message?: string | null } | null | undefined) {
  return /gram_(prices|costs_rmb)/.test(error?.message ?? "");
}

/** numeric[] from PostgREST (numbers or numeric strings) → number[]; null when absent/empty. */
export function parseGramArray(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out = raw.map((value) => Number(value));
  return out.every((value) => Number.isFinite(value)) ? out : null;
}
