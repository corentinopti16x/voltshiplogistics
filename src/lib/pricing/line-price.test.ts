import { describe, expect, it } from "vitest";
import {
  buildLinePriceCells,
  linePriceBrackets,
  linePriceCostRmb,
  linePriceKey,
  normalizeLinePrice,
  type LinePrice,
} from "./line-price";

const price: LinePrice = {
  tiers: [
    { maxG: 500, perKgRmb: 90, feeRmb: 18 },
    { maxG: 2000, perKgRmb: 80, feeRmb: 22 },
  ],
  minBillableG: 50,
};

describe("normalizeLinePrice", () => {
  it("accepts tiers in increasing weight", () => {
    const result = normalizeLinePrice({
      tiers: [
        { maxG: "500", perKgRmb: "90", feeRmb: "18" },
        { maxG: 2000, perKgRmb: 80, feeRmb: 22 },
      ],
      minBillableG: "",
    });
    expect(result).toEqual({
      ok: true,
      price: { tiers: price.tiers, minBillableG: 0 },
    });
  });

  it("refuses an empty list, unordered weights, bad amounts and a bad minimum", () => {
    expect(normalizeLinePrice({ tiers: [] })).toEqual({
      ok: false,
      error: "empty",
    });
    expect(
      normalizeLinePrice({
        tiers: [
          { maxG: 2000, perKgRmb: 80, feeRmb: 22 },
          { maxG: 500, perKgRmb: 90, feeRmb: 18 },
        ],
      }),
    ).toEqual({ ok: false, error: "weights" });
    expect(
      normalizeLinePrice({ tiers: [{ maxG: 500, perKgRmb: 0, feeRmb: 0 }] }),
    ).toEqual({ ok: false, error: "amounts" });
    expect(
      normalizeLinePrice({ tiers: [{ maxG: 500, perKgRmb: -1, feeRmb: 5 }] }),
    ).toEqual({ ok: false, error: "amounts" });
    expect(
      normalizeLinePrice({
        tiers: [{ maxG: 500, perKgRmb: 90, feeRmb: 18 }],
        minBillableG: 600,
      }),
    ).toEqual({ ok: false, error: "min_billable" });
  });
});

describe("linePriceCostRmb", () => {
  it("bills fee + per kilo at the exact gram", () => {
    expect(linePriceCostRmb(price, 137)).toBe(30.33);
    expect(linePriceCostRmb(price, 500)).toBe(63);
  });

  it("switches tier 1 g after the previous one", () => {
    expect(linePriceCostRmb(price, 501)).toBe(62.08);
  });

  it("never bills under the minimum billable weight", () => {
    expect(linePriceCostRmb(price, 10)).toBe(22.5);
    expect(linePriceCostRmb(price, 50)).toBe(22.5);
  });

  it("returns null above the heaviest tier", () => {
    expect(linePriceCostRmb(price, 2001)).toBeNull();
  });
});

describe("linePriceBrackets", () => {
  it("covers every gram once, up to the line's limit", () => {
    const brackets = linePriceBrackets(3200);
    expect(brackets[0]).toEqual({ minG: 0, maxG: 50 });
    expect(brackets[1]).toEqual({ minG: 51, maxG: 100 });
    expect(brackets.find((item) => item.maxG === 2000)).toEqual({
      minG: 1951,
      maxG: 2000,
    });
    expect(brackets.slice(-3)).toEqual([
      { minG: 2001, maxG: 2500 },
      { minG: 2501, maxG: 3000 },
      { minG: 3001, maxG: 3200 },
    ]);
    for (let index = 1; index < brackets.length; index += 1) {
      expect(brackets[index].minG).toBe(brackets[index - 1].maxG + 1);
    }
  });

  it("ends a small line at its own limit", () => {
    expect(linePriceBrackets(120).slice(-1)).toEqual([
      { minG: 101, maxG: 120 },
    ]);
  });
});

describe("buildLinePriceCells", () => {
  const cells = buildLinePriceCells(price, (cost) => Math.round(cost) / 10);

  it("carries one cost and one client price per gram", () => {
    const cell = cells.find((item) => item.weightMinG === 101);
    expect(cell?.weightMaxG).toBe(150);
    expect(cell?.gramCostsRmb).toHaveLength(50);
    // 137 g → index 36 of the 101–150 g bracket.
    expect(cell?.gramCostsRmb[36]).toBe(30.33);
    expect(cell?.gramPrices[36]).toBe(3);
  });

  it("keeps the heaviest gram as the flat bracket value", () => {
    const cell = cells.find((item) => item.weightMaxG === 500);
    expect(cell?.carrierCostRmb).toBe(63);
    expect(cell?.price).toBe(6.3);
  });

  it("stops at the heaviest tier", () => {
    expect(Math.max(...cells.map((item) => item.weightMaxG))).toBe(2000);
  });
});

describe("linePriceKey", () => {
  it("is the same whatever the case of the country", () => {
    expect(
      linePriceKey({
        destination: " us ",
        channel: "standard",
        carrier: "YunExpress",
        lineName: "商派普货",
      }),
    ).toBe("US|standard|YunExpress|商派普货");
  });
});
