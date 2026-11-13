import { describe, expect, it } from "vitest";
import { sourcingDecision } from "./decision";

describe("sourcingDecision", () => {
  it("rates the landed cost against the selling price", () => {
    expect(sourcingDecision({ sellingPrice: 49.9, cogs: 12, shipping: 4 })).toMatchObject({
      costLevel: "good",
      left: 37.9,
      heavy: false,
    });
    expect(sourcingDecision({ sellingPrice: 40, cogs: 14, shipping: 4 }).costLevel).toBe("limit");
    expect(sourcingDecision({ sellingPrice: 59.9, cogs: 33.29, shipping: 22 })).toMatchObject({
      costLevel: "bad",
      heavy: true,
    });
  });

  it("says nothing about the price without a selling price", () => {
    const result = sourcingDecision({ sellingPrice: null, cogs: 12, shipping: 7 });
    expect(result.costLevel).toBeNull();
    expect(result.heavy).toBe(false);
  });

  it("does not call a light product heavy when its price is good", () => {
    // 48 g, shipping is 70 % of the cost (carrier minimum), cost is 16 % of the selling price.
    expect(sourcingDecision({ sellingPrice: 34.99, cogs: 5.61, shipping: 3.92 })).toMatchObject({
      costLevel: "good",
      heavy: false,
    });
  });

  it("says nothing without a landed cost", () => {
    expect(sourcingDecision({ sellingPrice: 30, cogs: null, shipping: null })).toEqual({
      costShare: null,
      costLevel: null,
      left: null,
      shippingShare: null,
      heavy: false,
    });
  });
});
