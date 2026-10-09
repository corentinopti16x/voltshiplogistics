import { describe, expect, it } from "vitest";
import {
  billedWeightG,
  calculateCogs,
  findRateCell,
  parseParcelDimensions,
  volumetricWeightG,
  freezeQuote,
  gridVersionDate,
  normalizeDestination,
  parseAcceptedQuoteSnapshot,
  parseDestinationMarkets,
  ratesChangedSinceQuote,
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
  {
    gridVersion: "2026-09-21.1",
    carrier: "YunExpress",
    destination: "FR",
    channel: "standard",
    weightMinG: 501,
    weightMaxG: 1000,
    price: 6.5,
  },
  {
    gridVersion: "2026-09-21.1",
    carrier: "YunExpress",
    destination: "FR",
    channel: "standard",
    weightMinG: 1001,
    weightMaxG: 2000,
    price: 9.8,
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
        weightG: 2800,
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

  describe("quantity scaling (COGS 1–5)", () => {
    const base = {
      clientPrice: 4.2,
      weightG: 420,
      channel: "standard" as const,
      destination: "FR",
      cells,
      commissionPct: 5,
      handlingFee: 0.8,
    };

    it("defaults to one unit and keeps the single-unit figures", () => {
      const single = calculateCogs(base);
      expect(single).toMatchObject({
        quantity: 1,
        weightG: 420,
        product: 4.2,
        shipping: 3.9,
        handling: 0.8,
        commission: 0.21,
        cogs: 9.11,
        cogsPerUnit: 9.11,
      });
      expect(calculateCogs({ ...base, quantity: 1 })).toEqual(single);
    });

    it("picks the rate bracket for the parcel weight n × unit weight", () => {
      // 2 × 420 g = 840 g → 501–1000 g bracket; 3 × 420 g = 1260 g → 1001–2000 g.
      expect(calculateCogs({ ...base, quantity: 2 })).toMatchObject({
        quantity: 2,
        weightG: 840,
        shippingBase: 6.5,
      });
      expect(calculateCogs({ ...base, quantity: 3 })).toMatchObject({
        weightG: 1260,
        shippingBase: 9.8,
      });
    });

    it("scales product and commission per unit; handling per order grows with the parcel", () => {
      const result = calculateCogs({ ...base, quantity: 3 });
      // handling 0,80 € + 0,30 € for 3 units (default +0,15 € per extra unit)
      expect(result).toMatchObject({
        product: 12.6,
        commission: 0.63,
        handling: 1.1,
        shipping: 9.8,
        cogs: 24.13,
        cogsPerUnit: 8.0433,
      });
    });

    it("returns null when the parcel weight falls outside the grid", () => {
      // 5 × 420 g = 2100 g: no bracket above 2000 g.
      expect(calculateCogs({ ...base, quantity: 5 })).toBeNull();
      expect(calculateCogs({ ...base, quantity: 0 })).toBeNull();
      expect(calculateCogs({ ...base, quantity: 1.5 })).toBeNull();
    });
  });

  it("parses the brief's destination markets with FR as fallback", () => {
    expect(parseDestinationMarkets("FR, Germany; es")).toEqual(["FR", "DE", "ES"]);
    expect(parseDestinationMarkets("fr, FR")).toEqual(["FR"]);
    expect(parseDestinationMarkets("")).toEqual(["FR"]);
    expect(parseDestinationMarkets(undefined, "IN")).toEqual(["IN"]);
  });

  it("reads older accepted snapshots as single-unit quotes", () => {
    const snapshot = parseAcceptedQuoteSnapshot({
      grid_version: "2026-08-01.1",
      carrier: "YunExpress",
      destination: "FR",
      channel: "standard",
      accepted_at: "2026-08-02T00:00:00.000Z",
      weight_g: 420,
      client_price: 4.2,
      shipping: 3.9,
      handling: 0.8,
      cogs: 8.9,
    });
    expect(snapshot).toMatchObject({ quantity: 1, product: 4.2, cogsPerUnit: 8.9 });
  });

  it("flags rates that changed since the accepted quote", () => {
    const live = calculateCogs(base1())!;
    const frozen = freezeQuote(live, "2026-09-21T00:00:00.000Z");
    expect(ratesChangedSinceQuote(frozen, live, "2026-09-21.1")).toBe(false);
    expect(ratesChangedSinceQuote(frozen, live, "2026-10-01.1")).toBe(true);
    expect(
      ratesChangedSinceQuote(frozen, { ...live, shipping: 4.4, cogs: live.cogs + 0.5 }, "2026-09-21.1"),
    ).toBe(true);
    expect(ratesChangedSinceQuote(null, live, "2026-10-01.1")).toBe(false);
  });

  it("extracts the grid date from the version", () => {
    expect(gridVersionDate("2026-09-21.1")).toBe("2026-09-21");
    expect(gridVersionDate("v3")).toBeNull();
  });
});

function base1() {
  return {
    clientPrice: 4.2,
    weightG: 420,
    channel: "standard" as const,
    destination: "FR",
    cells,
  };
}

describe("carrier line and weight tier on the breakdown", () => {
  it("carries line name and bracket from the cell into the frozen snapshot", () => {
    const live = calculateCogs({
      clientPrice: 10,
      weightG: 300,
      channel: "standard",
      destination: "FR",
      cells: [{ ...cells[0], lineName: "YunExpress CHC" }, cells[1], cells[2]],
    });
    expect(live).toMatchObject({
      carrier: "YunExpress",
      lineName: "YunExpress CHC",
      weightMinG: 0,
      weightMaxG: 500,
      deliveryRange: "8–12 days",
    });
    const snapshot = parseAcceptedQuoteSnapshot(
      JSON.parse(JSON.stringify(freezeQuote(live!, "2026-09-21T00:00:00.000Z"))),
    );
    expect(snapshot).toMatchObject({ lineName: "YunExpress CHC", weightMinG: 0, weightMaxG: 500 });
  });

  it("defaults the tier to the parcel weight on legacy snapshots", () => {
    const snapshot = parseAcceptedQuoteSnapshot({
      gridVersion: "v1",
      carrier: "4PX",
      destination: "FR",
      channel: "standard",
      acceptedAt: "2026-09-21T00:00:00.000Z",
      weightG: 300,
      clientPrice: 10,
      shipping: 4,
      handling: 1,
      cogs: 15,
    });
    expect(snapshot).toMatchObject({ lineName: null, weightMinG: 300, weightMaxG: 300 });
  });
});

describe("billed weight (volumetric, USA minimum, IOSS)", () => {
  const grid: RateCell[] = [
    { gridVersion: "V1", carrier: "Huahan", destination: "FR", channel: "standard", weightMinG: 0, weightMaxG: 500, price: 5 },
    { gridVersion: "V1", carrier: "Huahan", destination: "FR", channel: "standard", weightMinG: 501, weightMaxG: 1000, price: 9 },
    { gridVersion: "V1", carrier: "Tongyou", destination: "FR", channel: "standard", weightMinG: 0, weightMaxG: 500, price: 5.5, iossRequired: true },
    { gridVersion: "V1", carrier: "Tongyou", destination: "FR", channel: "standard", weightMinG: 501, weightMaxG: 1000, price: 8 },
    { gridVersion: "V1", carrier: "Tongyou", destination: "US", channel: "standard", weightMinG: 0, weightMaxG: 50, price: 4 },
    { gridVersion: "V1", carrier: "Tongyou", destination: "US", channel: "standard", weightMinG: 51, weightMaxG: 100, price: 6 },
  ];
  const box = { length_cm: 20, width_cm: 20, height_cm: 10 }; // 4 000 cm³

  it("computes the volumetric weight with the carrier divisor and takes the max", () => {
    expect(volumetricWeightG(box, 1, 8000)).toBe(500);
    expect(volumetricWeightG(box, 1, 6000)).toBe(667);
    expect(volumetricWeightG(box, 3, 8000)).toBe(1500); // n × unit volume
    expect(volumetricWeightG(null, 1, 8000)).toBeNull();
    expect(billedWeightG({ actualG: 300, carrier: "Tongyou", destination: "FR", dimensionsCm: box })).toBe(500);
    expect(billedWeightG({ actualG: 300, carrier: "Huahan", destination: "FR", dimensionsCm: box })).toBe(667);
    expect(billedWeightG({ actualG: 900, carrier: "Huahan", destination: "FR", dimensionsCm: box })).toBe(900);
    expect(billedWeightG({ actualG: 300, carrier: "Tongyou", destination: "FR" })).toBe(300);
    expect(billedWeightG({ actualG: 20, carrier: "Tongyou", destination: "US" })).toBe(50);
    expect(
      billedWeightG({ actualG: 300, carrier: "Huahan", destination: "FR", dimensionsCm: box, volumetricDivisors: { default: 5000 } }),
    ).toBe(800);
  });

  it("matches each carrier on its own billed weight and reports it in the breakdown", () => {
    // 300 g actual, 4 000 cm³: Tongyou bills 500 g (0–500 @ 5.5), Huahan bills 667 g (501–1000 @ 9).
    const cell = findRateCell(grid, { weightG: 300, channel: "standard", destination: "FR", dimensionsCm: box });
    expect(cell?.carrier).toBe("Tongyou");
    const breakdown = calculateCogs({ clientPrice: 10, weightG: 300, channel: "standard", destination: "FR", cells: grid, dimensionsCm: box });
    expect(breakdown).toMatchObject({ carrier: "Tongyou", weightG: 300, billedWeightG: 500, volumetricWeightG: 500, iossRequired: true });
    // Without dimensions Huahan (0–500 @ 5) is cheapest and the billed weight is the actual one.
    const plain = calculateCogs({ clientPrice: 10, weightG: 300, channel: "standard", destination: "FR", cells: grid });
    expect(plain).toMatchObject({ carrier: "Huahan", billedWeightG: 300, volumetricWeightG: null, iossRequired: false });
    // Quantity 2: 600 g actual, volumetric 1 000 g for Tongyou → 501–1000 @ 8.
    const two = calculateCogs({ clientPrice: 10, weightG: 300, channel: "standard", destination: "FR", cells: grid, dimensionsCm: box, quantity: 2 });
    expect(two).toMatchObject({ weightG: 600, billedWeightG: 1000, shippingBase: 8 });
  });

  it("bills at least 50 g in the USA", () => {
    const us = calculateCogs({ clientPrice: 10, weightG: 20, channel: "standard", destination: "US", cells: grid });
    expect(us).toMatchObject({ billedWeightG: 50, shippingBase: 4 });
  });

  it("reads dimensions from quote_json like the ECCANG mapping", () => {
    expect(parseParcelDimensions({ length_cm: "20", width_cm: 20, height_cm: 10 })).toEqual(box);
    expect(parseParcelDimensions({ length_cm: 20, width_cm: 20 })).toBeNull();
    expect(parseParcelDimensions(null)).toBeNull();
  });

  it("keeps the billed weight and IOSS flag in the frozen snapshot", () => {
    const breakdown = calculateCogs({ clientPrice: 10, weightG: 300, channel: "standard", destination: "FR", cells: grid, dimensionsCm: box })!;
    const snapshot = parseAcceptedQuoteSnapshot(JSON.parse(JSON.stringify(freezeQuote(breakdown))));
    expect(snapshot).toMatchObject({ billedWeightG: 500, iossRequired: true });
    expect(parseAcceptedQuoteSnapshot({ ...freezeQuote(breakdown), billedWeightG: undefined, iossRequired: undefined })).toMatchObject({
      billedWeightG: 300,
      iossRequired: false,
    });
  });
});
