import { describe, expect, it } from "vitest";
import {
  appendHistory,
  isOpenPurchaseOrder,
  purchaseOrderReference,
  purchaseOrderTotal,
  stepIndex,
} from "./core";

describe("purchase orders", () => {
  it("builds references", () => {
    expect(purchaseOrderReference("liora us", new Date("2026-10-08T05:00:00Z"), 0)).toBe("PO-LIORAUS-261008-1");
  });
  it("computes totals", () => {
    expect(purchaseOrderTotal(500, 2.345)).toBe(1172.5);
    expect(purchaseOrderTotal(500, 2, 990)).toBe(990);
    expect(purchaseOrderTotal(10, null)).toBeNull();
  });
  it("tracks status", () => {
    expect(isOpenPurchaseOrder("in_production")).toBe(true);
    expect(isOpenPurchaseOrder("received")).toBe(false);
    expect(stepIndex("quality_check")).toBe(2);
    expect(stepIndex("cancelled")).toBe(-1);
    const now = new Date("2026-10-08T00:00:00Z");
    const h1 = appendHistory([], "to_pay", now);
    expect(appendHistory(h1, "to_pay", now)).toHaveLength(1);
    expect(appendHistory(h1, "in_production", now)).toHaveLength(2);
  });
});
