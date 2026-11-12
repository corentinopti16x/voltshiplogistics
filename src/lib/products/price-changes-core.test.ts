import { describe, expect, it } from "vitest";
import { latestPriceChanges } from "./price-changes-core";

const row = (entity: string, market: string, before: number, after: number, at: string) => ({
  entity,
  diff_json: { market, before, after },
  created_at: at,
});

describe("latestPriceChanges", () => {
  it("keeps the latest change per product and market, newest first", () => {
    const out = latestPriceChanges([
      row("a", "US", 10, 11, "2026-11-01T08:00:00Z"),
      row("a", "US", 11, 12, "2026-11-10T08:00:00Z"),
      row("b", "FR", 5, 6, "2026-11-12T08:00:00Z"),
    ]);
    expect(out.map((c) => [c.productId, c.before, c.after])).toEqual([
      ["b", 5, 6],
      ["a", 11, 12],
    ]);
  });

  it("merges changes of the same day", () => {
    const out = latestPriceChanges([
      row("a", "US", 10, 11, "2026-11-12T08:00:00Z"),
      row("a", "US", 11, 12.5, "2026-11-12T09:00:00Z"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ before: 10, after: 12.5 });
  });

  it("drops a change that comes back to the starting price, and broken rows", () => {
    const out = latestPriceChanges([
      row("a", "US", 10, 11, "2026-11-12T08:00:00Z"),
      row("a", "US", 11, 10, "2026-11-12T09:00:00Z"),
      { entity: null, diff_json: { market: "US", before: 1, after: 2 }, created_at: "2026-11-12T09:00:00Z" },
      { entity: "c", diff_json: { market: "US", before: "x", after: 2 }, created_at: "2026-11-12T09:00:00Z" },
    ]);
    expect(out).toEqual([]);
  });
});
