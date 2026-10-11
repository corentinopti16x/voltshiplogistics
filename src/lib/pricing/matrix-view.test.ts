import { describe, expect, it } from "vitest";
import { calculateCogs, type RateCell } from "../domain/pricing";
import { cellUsesOtherLine, matrixViews } from "./matrix-view";

const cell = (carrier: string, lineName: string, min: number, max: number, price: number): RateCell => ({
  gridVersion: "V3",
  carrier,
  destination: "FR",
  channel: "standard",
  weightMinG: min,
  weightMaxG: max,
  price,
  deliveryRange: "6-9",
  lineName,
  iossRequired: false,
  carrierCostRmb: null,
});

// YunExpress is cheaper up to 500 g, 4PX above: a 2-unit parcel switches line.
const cells = [
  cell("YunExpress", "商派", 1, 500, 5),
  cell("YunExpress", "商派", 501, 1000, 12),
  cell("4PX", "联邮通", 1, 500, 6),
  cell("4PX", "联邮通", 501, 1000, 9),
];

const breakdown = (quantity: number, preference: { carrier: string; lineName: string | null } | null = null) =>
  calculateCogs({
    clientPrice: 3,
    weightG: 300,
    channel: "standard",
    destination: "FR",
    cells,
    quantity,
    carrierPreference: preference,
  });

describe("matrixViews", () => {
  it("names the 1-unit line of each market and flags cells on another line", () => {
    const { matrixMarkets, carrierMarkets } = matrixViews({
      markets: [
        {
          destination: "FR",
          cells: [1, 2].map((quantity) => ({ quantity, breakdown: breakdown(quantity) })),
          options: [],
          preference: null,
          forced: false,
        },
      ],
    });
    const fr = matrixMarkets[0];
    expect(fr.line).toEqual({ carrier: "YunExpress", lineName: "商派" });
    expect(fr.mode).toBe("auto");
    expect(fr.deliveryRange).toBe("6-9");
    expect(cellUsesOtherLine(fr.cells[0], fr.line)).toBe(false);
    expect(fr.cells[1].carrier).toBe("4PX");
    expect(cellUsesOtherLine(fr.cells[1], fr.line)).toBe(true);
    expect(carrierMarkets[0].selectionReason).toBe("cheapest");
  });

  it("reports a chosen line and its fallback", () => {
    const chosen = { carrier: "4PX", lineName: "联邮通" };
    const { matrixMarkets } = matrixViews({
      markets: [
        {
          destination: "FR",
          cells: [{ quantity: 1, breakdown: breakdown(1, chosen) }],
          options: [],
          preference: chosen,
          forced: false,
        },
        {
          destination: "FR",
          cells: [{ quantity: 1, breakdown: breakdown(1, { carrier: "Huahan", lineName: null }) }],
          options: [],
          preference: { carrier: "Huahan", lineName: null },
          forced: true,
        },
      ],
    });
    expect(matrixMarkets[0].line).toEqual(chosen);
    expect(matrixMarkets[0].mode).toBe("preferred");
    expect(matrixMarkets[0].fallback).toBe(false);
    expect(matrixMarkets[1].mode).toBe("forced");
    expect(matrixMarkets[1].fallback).toBe(true);
    expect(matrixMarkets[1].line?.carrier).toBe("YunExpress");
  });
});
