import { describe, expect, it } from "vitest";
import { calculateCogs, discountedShipping, handlingForQuantity, type RateCell } from "./pricing";

describe("handling ladder", () => {
  it("grows with the parcel: +0,25 € per extra unit by default", () => {
    expect([1, 2, 3, 4, 5].map((q) => handlingForQuantity(1, q))).toEqual([1, 1.25, 1.5, 1.75, 2]);
    expect(handlingForQuantity(1, 5, { step2: 0.3, step3: 0.5, extraUnit: 0.2 })).toBe(1.9);
  });
});

describe("transport after the palier discount", () => {
  it("never goes below the carrier cost", () => {
    // Tongyou 160 g: 43 RMB → 5,733 € cost; grid price 6,33 € ; −10 % = 5,70 € → floored to 5,74 €
    expect(discountedShipping(6.33, 0.1, 43, 7.5)).toBe(5.74);
    expect(discountedShipping(5.4, 0.1, 36, 7.5)).toBe(4.86);
    expect(discountedShipping(5.4, 0.1, null, 7.5)).toBe(4.86);
  });
});

describe("Magnesium Complex — Maxime Ultra VIP, France", () => {
  const cell = (min: number, max: number, rmb: number): RateCell => ({
    gridVersion: "V2",
    carrier: "Tongyou",
    lineName: "Tongyou TK特货",
    destination: "FR",
    channel: "sensitive_other",
    weightMinG: min,
    weightMaxG: max,
    price: Math.round((rmb / 7.5 + Math.max((rmb / 7.5) * 0.1, 0.6)) * 20) / 20,
    carrierCostRmb: rmb,
  });
  const cells = [cell(51, 100, 36), cell(151, 200, 43), cell(201, 250, 46.5), cell(301, 350, 53.5)];
  it("client pays more per parcel as the quantity grows, never under the transport cost", () => {
    const cogs = [1, 2, 3, 4].map(
      (quantity) =>
        calculateCogs({
          clientPrice: 9.7 / 7.5,
          weightG: 80,
          channel: "sensitive_other",
          destination: "FR",
          cells,
          quantity,
          handlingFee: 1,
          commissionPct: 3,
          logisticsDiscountPct: 10,
          fxRmbPerEur: 7.5,
        })!,
    );
    expect(cogs.map((c) => c.handling)).toEqual([1, 1.25, 1.5, 1.75]);
    // Maxime pays 7,19 / 9,65 / 11,70 / 14,22 € — always under Sylvia (7,88 / 10,17 / 12,46 / 14,75 €)
    expect(cogs.map((c) => Math.round(c.cogs * 100) / 100)).toEqual([7.19, 9.65, 11.7, 14.22]);
    expect(cogs.map((c) => c.shipping)).toEqual([4.86, 5.74, 6.2, 7.14]);
    expect(cogs[1].shipping).toBe(5.74);
  });
});
