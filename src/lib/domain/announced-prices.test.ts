import { describe, expect, it } from "vitest";
import { announcedPriceFor, applyAnnouncedPrice, calculateCogs, parseAnnouncedPrices, type RateCell } from "./pricing";

describe("prix annoncés", () => {
  it("parses only valid markets / quantities / prices", () => {
    expect(parseAnnouncedPrices({ IT: { "1": 9.75, "2": "14.5", "9": 0, x: 3 }, fr: { "1": 5 } })).toEqual({
      IT: { "1": 9.75, "2": 14.5 },
    });
    expect(announcedPriceFor({ IT: { "1": 9.75 } }, "it", 1)).toBe(9.75);
    expect(announcedPriceFor({ IT: { "1": 9.75 } }, "IT", 2)).toBeNull();
  });

  it("bills exactly the promised total (Blue Light, Maat VIP, Italie)", () => {
    const cell: RateCell = {
      gridVersion: "V2",
      carrier: "YunExpress",
      lineName: "THDDR-CHC",
      destination: "IT",
      channel: "electronics_battery",
      weightMinG: 301,
      weightMaxG: 350,
      price: 7.15,
      carrierCostRmb: 48.8,
    };
    const computed = calculateCogs({
      clientPrice: 14.05 / 7.5,
      weightG: 340,
      channel: "electronics_battery",
      destination: "IT",
      cells: [cell],
      handlingFee: 1,
      commissionPct: 5,
      logisticsDiscountPct: 5,
      fxRmbPerEur: 7.5,
    })!;
    expect(Math.round(computed.cogs * 100) / 100).toBe(9.76);
    const announced = applyAnnouncedPrice(computed, 9.75);
    expect(announced.cogs).toBe(9.75);
    expect(announced.announced).toBe(true);
    expect(Math.round((announced.product + announced.commission + announced.shipping + announced.handling) * 100) / 100).toBe(9.75);
  });
});
