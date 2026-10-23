import { describe, expect, it } from "vitest";
import {
  announcedKitPriceFor,
  announcedPriceFor,
  applyAnnouncedBundlePrice,
  applyAnnouncedPrice,
  calculateCogs,
  matchAnnouncedKit,
  parseAnnouncedKits,
  parseAnnouncedPrices,
  type RateCell,
} from "./pricing";

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

describe("announced price expiry and alerts", () => {
  it("drops a market once its guarantee date is past", async () => {
    const { activeAnnouncedPrices } = await import("./pricing");
    const quote = {
      announced_prices: { IT: { "1": 9.75 }, FR: { "1": 8 } },
      announced_until: { IT: "2026-12-31", FR: "2026-10-01" },
    };
    expect(activeAnnouncedPrices(quote, "2026-12-31")).toEqual({ IT: { "1": 9.75 } });
    expect(activeAnnouncedPrices(quote, "2027-01-01")).toEqual({});
    expect(activeAnnouncedPrices({ announced_prices: { IT: { "1": 9.75 } } }, "2030-01-01")).toEqual({ IT: { "1": 9.75 } });
  });

  it("classifies a locked price against the live margin", async () => {
    const { classifyAnnouncedPrice } = await import("./pricing");
    const base = { today: "2026-10-09", threshold: 0.5 };
    expect(classifyAnnouncedPrice({ ...base, until: "2026-10-01", margin: 2 })).toBe("expired");
    expect(classifyAnnouncedPrice({ ...base, until: null, margin: -0.2 })).toBe("loss");
    expect(classifyAnnouncedPrice({ ...base, until: null, margin: 0.3 })).toBe("low_margin");
    expect(classifyAnnouncedPrice({ ...base, until: "2026-10-20", margin: 1.2 })).toBe("expiring");
    expect(classifyAnnouncedPrice({ ...base, until: "2026-12-31", margin: 1.2 })).toBe("ok");
    expect(classifyAnnouncedPrice({ ...base, until: null, margin: null })).toBe("no_data");
  });
});

describe("announced kit prices", () => {
  const kits = parseAnnouncedKits({
    IT: { refill: { "1": 10.48, "3": "11.92", "7": 99, x: 1, "6": -2 } },
    it: { refill: { "1": 1 } },
  });

  it("parses markets, companions and quantities, dropping bad entries", () => {
    expect(kits).toEqual({ IT: { refill: { "1": 10.48, "3": 11.92, "7": 99 } } });
  });

  it("prices main ×1 + N of one companion only", () => {
    expect(announcedKitPriceFor(kits, "it", "gun", [{ productId: "gun", quantity: 1 }, { productId: "refill", quantity: 3 }])).toBe(11.92);
    // Main twice, a third product, no companion or an unpriced quantity → no kit price.
    expect(announcedKitPriceFor(kits, "IT", "gun", [{ productId: "gun", quantity: 2 }, { productId: "refill", quantity: 3 }])).toBeNull();
    expect(
      announcedKitPriceFor(kits, "IT", "gun", [
        { productId: "gun", quantity: 1 },
        { productId: "refill", quantity: 1 },
        { productId: "case", quantity: 1 },
      ]),
    ).toBeNull();
    expect(announcedKitPriceFor(kits, "IT", "gun", [{ productId: "gun", quantity: 1 }])).toBeNull();
    expect(announcedKitPriceFor(kits, "IT", "gun", [{ productId: "gun", quantity: 1 }, { productId: "refill", quantity: 2 }])).toBeNull();
    expect(announcedKitPriceFor(kits, "FR", "gun", [{ productId: "gun", quantity: 1 }, { productId: "refill", quantity: 1 }])).toBeNull();
  });

  it("adds split lines of the same product", () => {
    expect(
      announcedKitPriceFor(kits, "IT", "gun", [
        { productId: "gun", quantity: 1 },
        { productId: "refill", quantity: 2 },
        { productId: "refill", quantity: 1 },
      ]),
    ).toBe(11.92);
  });

  it("finds the kit on whichever product carries it, and drops expired markets", () => {
    type Row = { id: string; quote_json: Record<string, unknown> | null };
    const gun: Row = { id: "gun", quote_json: { announced_kits: { IT: { refill: { "1": 10.48 } } } } };
    const refill: Row = { id: "refill", quote_json: null };
    const lines = [
      { product: refill, quantity: 1 },
      { product: gun, quantity: 1 },
    ];
    expect(matchAnnouncedKit(lines, "IT", "2026-10-26")).toBe(10.48);
    const expired: Row = { ...gun, quote_json: { ...gun.quote_json, announced_until: { IT: "2026-10-25" } } };
    expect(matchAnnouncedKit([{ product: expired, quantity: 1 }, { product: refill, quantity: 1 }], "IT", "2026-10-26")).toBeNull();
  });

  it("locks the bundle total, transport absorbs the gap", () => {
    const breakdown = {
      items: [],
      units: 4,
      contentWeightG: 440,
      packagingWeightG: 25,
      weightG: 465,
      billedWeightG: 465,
      carrier: "Tongyou",
      lineName: "TK特货",
      deliveryRange: null,
      selectionReason: "cheapest" as const,
      product: 2.23,
      commission: 0,
      box: 0,
      shippingBase: 8.6,
      shipping: 8.6,
      handling: 1.56,
      cogs: 12.39,
    };
    const locked = applyAnnouncedBundlePrice(breakdown, 11.92);
    expect(locked.cogs).toBe(11.92);
    expect(locked.shipping).toBe(8.13);
    expect(locked.announced).toBe(true);
  });
});
