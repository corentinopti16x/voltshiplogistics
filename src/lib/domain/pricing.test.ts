import { describe, expect, it } from "vitest";
import {
  calculateCogs,
  findRateCell,
  freezeQuote,
  normalizeDestination,
  type RateCell,
} from "./pricing";

const cells: RateCell[] = [
  {
    gridVersion: "2026-09-21.1",
    carrier: "YunExpress",
    destination: "FR",
    channel: "standard",
    weightMinG: 0,
    weightMaxG: 500,
    price: 3.9,
    deliveryRange: "8–12 days",
  },
  {
    gridVersion: "2026-09-21.1",
    carrier: "4PX",
    destination: "FR",
    channel: "standard",
    weightMinG: 0,
    weightMaxG: 500,
    price: 4.1,
  },
];

describe("pricing", () => {
  it("normalizes common market names to country codes", () => {
    expect(normalizeDestination("india")).toBe("IN");
    expect(normalizeDestination("FR, DE")).toBe("FR");
  });

  it("selects the cheapest matching bracket", () => {
    expect(
      findRateCell(cells, {
        weightG: 420,
        destination: "fr",
        channel: "standard",
      })?.carrier,
    ).toBe("YunExpress");
  });

  it("returns null when no bracket matches", () => {
    expect(
      calculateCogs({
        clientPrice: 4.2,
        weightG: 800,
        channel: "standard",
        destination: "FR",
        cells,
      }),
    ).toBeNull();
  });

  it("applies commission, handling and shipping discount once", () => {
    const result = calculateCogs({
      clientPrice: 4.2,
      weightG: 420,
      channel: "standard",
      destination: "FR",
      cells,
      commissionPct: 5,
      handlingFee: 1.7,
      logisticsDiscountPct: 10,
    });
    expect(result).toMatchObject({
      gridVersion: "2026-09-21.1",
      clientPrice: 4.2,
      shippingBase: 3.9,
      shipping: 3.51,
      commission: 0.21,
      handling: 1.7,
      discount: 0.39,
      cogs: 9.62,
    });
  });

  it("freezes a versioned accepted snapshot", () => {
    const result = calculateCogs({
      clientPrice: 4.2,
      weightG: 420,
      channel: "standard",
      destination: "FR",
      cells,
    });
    expect(result).not.toBeNull();
    expect(freezeQuote(result!, "2026-09-21T00:00:00.000Z")).toMatchObject({
      gridVersion: "2026-09-21.1",
      cogs: 8.1,
      acceptedAt: "2026-09-21T00:00:00.000Z",
    });
  });
});
