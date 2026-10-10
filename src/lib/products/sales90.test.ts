import { describe, expect, it } from "vitest";
import { unitsSold90d } from "./sales90";

describe("unitsSold90d", () => {
  it("sums each SKU once, through the import link or the SKU", () => {
    const units = unitsSold90d(
      [
        { id: "p1", client_id: "c", sku: "A" },
        { id: "p2", client_id: "c", sku: "B" },
        { id: "p3", client_id: "c", sku: null },
      ],
      [
        { id: "v1", client_id: "c", sku: "A", units_90d: 10, imported_product_id: "p1" },
        { id: "v2", client_id: "c", sku: "a", units_90d: 10, imported_product_id: null },
        { id: "v3", client_id: "c", sku: "A2", units_90d: 5, imported_product_id: "p1" },
        { id: "v4", client_id: "c", sku: "b", units_90d: 7, imported_product_id: null },
        { id: "v5", client_id: "other", sku: "B", units_90d: 99, imported_product_id: null },
      ],
    );
    expect(Object.fromEntries(units)).toEqual({ p1: 15, p2: 7, p3: 0 });
  });
});

describe("sevenDayTrends", () => {
  it("compares the last 7 days with the 7 before", async () => {
    const { productSkuKeys, sevenDayTrends } = await import("./sales90");
    const products = [
      { id: "p1", client_id: "c", sku: "A" },
      { id: "p2", client_id: "c", sku: "B" },
    ];
    const keys = productSkuKeys(products, [{ id: "v", client_id: "c", sku: "A2", units_90d: 0, imported_product_id: "p1" }]);
    const trends = sevenDayTrends(
      products,
      keys,
      [
        { client_id: "c", sku: "A", date: "2026-10-10", units_sold: 10 },
        { client_id: "c", sku: "a2", date: "2026-10-04", units_sold: 5 },
        { client_id: "c", sku: "A", date: "2026-10-03", units_sold: 10 },
        { client_id: "c", sku: "B", date: "2026-10-09", units_sold: 3 },
        { client_id: "c", sku: "A", date: "2026-09-20", units_sold: 99 },
      ],
      "2026-10-10",
    );
    expect(trends.get("p1")).toEqual({ last7: 15, previous7: 10, pct: 50, isNew: false });
    expect(trends.get("p2")).toEqual({ last7: 3, previous7: 0, pct: null, isNew: true });
  });
});
