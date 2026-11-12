/** One recorded change of what a client pays for 1 unit of a product on one market. */
export type PriceChange = {
  productId: string;
  market: string;
  before: number;
  after: number;
  /** ISO date-time of the change. */
  at: string;
};

export const PRICE_CHANGE_ACTION = "product.price_changed";

type AuditRow = {
  entity: string | null;
  diff_json: unknown;
  created_at: string;
};

/**
 * Latest change per product and market, newest first. Several changes the same day are
 * merged (first « before », last « after »); a change that ends where it started is dropped.
 */
export function latestPriceChanges(rows: AuditRow[]): PriceChange[] {
  const parsed: PriceChange[] = [];
  for (const row of rows) {
    const diff = (row.diff_json ?? {}) as Record<string, unknown>;
    const before = Number(diff.before);
    const after = Number(diff.after);
    const market = typeof diff.market === "string" ? diff.market : "";
    if (!row.entity || !market) continue;
    if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
    parsed.push({ productId: row.entity, market, before, after, at: row.created_at });
  }
  parsed.sort((a, b) => a.at.localeCompare(b.at));
  const byKey = new Map<string, PriceChange>();
  for (const change of parsed) {
    const key = `${change.productId}|${change.market}`;
    const previous = byKey.get(key);
    if (previous && previous.at.slice(0, 10) === change.at.slice(0, 10)) {
      byKey.set(key, { ...change, before: previous.before });
    } else {
      byKey.set(key, change);
    }
  }
  return [...byKey.values()]
    .filter((change) => Math.abs(change.after - change.before) >= 0.005)
    .sort((a, b) => b.at.localeCompare(a.at));
}
