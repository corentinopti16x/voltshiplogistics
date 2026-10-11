import { describe, expect, it } from "vitest";
import { decodeGramCurve, encodeGramCurve, gramCostsForBracket } from "./gram-curve";
import { gramCurveFromPoints } from "./matrix-import";
import { expandToCells, type ParsedPriceList } from "./ai-import";
import { DEFAULT_PRICING_SETTINGS } from "./settings";
import { calculateCogs, cellAtWeight, type RateCell } from "../domain/pricing";

describe("gram curve", () => {
  it("round-trips costs, blanks and runs", () => {
    const costs = [24.2, 24.2, 24.2, 24.26, 24.33, null, null, 26.57, 26.63];
    const curve = encodeGramCurve(costs);
    expect(decodeGramCurve(curve)).toEqual(costs);
    expect(curve.length).toBeLessThan(40);
  });

  it("fills a gram without price with the next heavier one", () => {
    expect(gramCostsForBracket([1, null, 3, 4], 1, 3, 9)).toEqual([1, 3, 3]);
    expect(gramCostsForBracket([1, 2], 2, 3, 9)).toEqual([2, 9]);
  });
});

describe("gram-exact billing", () => {
  // Huahan 内电-like line: 24.20 ¥ up to 100 g, then +0.0666 ¥/g.
  const points = Array.from({ length: 200 }, (_, i) => {
    const g = i + 1;
    return { g, price: g <= 100 ? 24.2 : Math.round((24.2 + (g - 100) * 0.0666) * 100) / 100 };
  });
  const parsed: ParsedPriceList = {
    carrier: "matrix",
    grid_date: null,
    currency: "RMB",
    all_inclusive: true,
    lines: [
      {
        line_name: "Huahan 内电",
        carrier: "Huahan",
        destination: "US",
        channel: "electronics_battery",
        tax_included: true,
        vat_extra: false,
        pricing: {
          type: "table",
          rows: [
            { min_g: 101, max_g: 150, price: points[149].price },
            { min_g: 151, max_g: 200, price: points[199].price },
          ],
        },
        confidence: 1,
        gram_curve: gramCurveFromPoints(points),
      },
    ],
  } as ParsedPriceList;

  it("stores the cost of every gram and bills the exact gram", () => {
    const [cell] = expandToCells(parsed, DEFAULT_PRICING_SETTINGS, {}, { withGrams: true });
    expect(cell.gramCostsRmb?.length).toBe(50);
    expect(cell.gramCostsRmb?.[19]).toBe(points[119].price); // 120 g
    const rateCell: RateCell = {
      gridVersion: "G",
      carrier: cell.carrier,
      destination: "US",
      channel: "electronics_battery",
      weightMinG: cell.weightMinG,
      weightMaxG: cell.weightMaxG,
      price: cell.price,
      lineName: cell.lineName,
      carrierCostRmb: cell.carrierCostRmb,
      gramPrices: cell.gramPrices,
      gramCostsRmb: cell.gramCostsRmb,
    };
    const at120 = cellAtWeight(rateCell, 120);
    expect(at120.carrierCostRmb).toBe(points[119].price);
    expect(at120.price).toBeLessThan(cell.price);
    const cogs = calculateCogs({
      clientPrice: 0,
      weightG: 120,
      channel: "electronics_battery",
      destination: "US",
      cells: [rateCell],
      batteryInternal: true,
    });
    expect(cogs?.shippingBase).toBe(at120.price);
    // Without the per-gram arrays the flat bracket price applies.
    const [flat] = expandToCells(parsed, DEFAULT_PRICING_SETTINGS, {});
    expect(flat.gramPrices).toBeUndefined();
  });
});
