import { describe, expect, it } from "vitest";
import { calculateCogs, type RateCell } from "../domain/pricing";
import { DEFAULT_PRICING_SETTINGS } from "./settings";
import { computeVoltshipMargin, extractCarrierCostRmb, rmbToEur, sumMargins } from "./margin";

// fx 7.5, handling cost 0.5, market fx 7.8; the per-parcel supplement defaults to 0 since the
// grid is all-inclusive — these tests keep the legacy 3 € to exercise the pass-through.
const settings = { ...DEFAULT_PRICING_SETTINGS, eu_parcel_tax_eur: 3, handling_cost_eur: 0.5 };

const cells: RateCell[] = [
  {
    gridVersion: "2026-10-01.1",
    carrier: "YunExpress",
    destination: "FR",
    channel: "standard",
    weightMinG: 0,
    weightMaxG: 500,
    price: 6.5,
    lineName: "YunExpress CHC",
    carrierCostRmb: 30,
    taxIncluded: false,
  },
  {
    gridVersion: "2026-10-01.1",
    carrier: "YunExpress",
    destination: "FR",
    channel: "standard",
    weightMinG: 501,
    weightMaxG: 1000,
    price: 9,
    lineName: "YunExpress CHC",
    carrierCostRmb: 45,
    taxIncluded: true,
  },
  {
    gridVersion: "2026-10-01.1",
    carrier: "Legacy",
    destination: "DE",
    channel: "standard",
    weightMinG: 0,
    weightMaxG: 500,
    price: 7,
  },
];

/** Client side exactly as the client sees it: price 10 €, 10 % commission, handling 1 €, 200 g. */
function clientBreakdown(quantity: number, destination = "FR") {
  return calculateCogs({
    clientPrice: 10,
    weightG: 200,
    channel: "standard",
    destination,
    cells,
    quantity,
    commissionPct: 10,
    handlingFee: 1,
    logisticsDiscountPct: 0,
  });
}

describe("computeVoltshipMargin", () => {
  it("splits the margin into sourcing, transport and handling for one unit", () => {
    const client = clientBreakdown(1);
    const result = computeVoltshipMargin({
      quantity: 1,
      client,
      factoryCostRmb: 45, // 6 €
      carrierCostRmb: 30, // 4 €
      carrierCostSource: "grid",
      taxIncluded: false,
      settings,
    });
    // Client pays: 10 + 1 (commission) + 6.5 (shipping) + 1 (handling) = 18.5
    expect(result.clientPays).toEqual({ product: 10, commission: 1, shipping: 6.5, handling: 1, total: 18.5 });
    expect(result.costs.factory).toBe(6);
    expect(result.costs.carrier).toBe(4);
    expect(result.costs.taxPassThrough).toBe(3);
    expect(result.costs.handling).toBe(0.5);
    expect(result.costs.total).toBe(13.5);
    // Sourcing: 11 − 6 = 5 ; transport: 6.5 − 4 − 3 = −0.5 ; handling: 1 − 0.5 = 0.5
    expect(result.margin.sourcing).toBe(5);
    expect(result.margin.transport).toBe(-0.5);
    expect(result.margin.handling).toBe(0.5);
    expect(result.margin.total).toBe(5);
    expect(result.margin.pct).toBeCloseTo(5 / 18.5, 4);
    expect(result.margin.perUnit).toBe(5);
    expect(result.complete).toBe(true);
    expect(result.flags).toEqual(["carrier_cost_estimated"]);
  });

  it("does not charge the EU tax pass-through on a tax-inclusive line", () => {
    const client = clientBreakdown(3); // 600 g → second bracket, price 9, tax included
    const result = computeVoltshipMargin({
      quantity: 3,
      client,
      factoryCostRmb: 45 * 3,
      carrierCostRmb: 45,
      carrierCostSource: "grid",
      taxIncluded: true,
      settings,
    });
    expect(result.clientPays.product).toBe(30);
    expect(result.clientPays.shipping).toBe(9);
    expect(result.costs.taxPassThrough).toBe(0);
    expect(result.margin.transport).toBe(3); // 9 − 6
    expect(result.margin.sourcing).toBe(15); // 33 − 18
    expect(result.margin.perUnit).toBeCloseTo((15 + 3 + 1) / 3, 4); // handling 1,50 € for 3 units − 0,50 € cost
  });

  it("returns null sourcing margin and flags a missing factory price", () => {
    const result = computeVoltshipMargin({
      quantity: 1,
      client: clientBreakdown(1),
      factoryCostRmb: null,
      carrierCostRmb: 30,
      carrierCostSource: "grid",
      taxIncluded: false,
      settings,
    });
    expect(result.costs.factory).toBeNull();
    expect(result.margin.sourcing).toBeNull();
    expect(result.margin.total).toBe(0); // transport −0.5 + handling 0.5
    expect(result.complete).toBe(false);
    expect(result.flags).toContain("factory_price_missing");
  });

  it("returns null transport margin and flags a legacy cell without carrier cost", () => {
    const result = computeVoltshipMargin({
      quantity: 1,
      client: clientBreakdown(1, "DE"),
      factoryCostRmb: 45,
      carrierCostRmb: null,
      carrierCostSource: null,
      taxIncluded: true,
      settings,
    });
    expect(result.clientPays.shipping).toBe(7);
    expect(result.costs.carrier).toBeNull();
    expect(result.margin.transport).toBeNull();
    expect(result.carrierCostSource).toBeNull();
    expect(result.flags).toEqual(["carrier_cost_unknown"]);
    expect(result.complete).toBe(false);
  });

  it("flags a real carrier cost from ECCANG fees", () => {
    const result = computeVoltshipMargin({
      quantity: 1,
      client: clientBreakdown(1),
      factoryCostRmb: 45,
      carrierCostRmb: 33,
      carrierCostSource: "real",
      taxIncluded: false,
      settings,
    });
    expect(result.costs.carrier).toBe(4.4);
    expect(result.carrierCostSource).toBe("real");
    expect(result.flags).toEqual(["carrier_cost_real"]);
  });

  it("estimates the FX margin from billing vs market rate on the RMB costs", () => {
    const result = computeVoltshipMargin({
      quantity: 1,
      client: clientBreakdown(1),
      factoryCostRmb: 45,
      carrierCostRmb: 30,
      carrierCostSource: "grid",
      taxIncluded: false,
      settings: { ...settings, fx_rmb_per_eur: 7.5, fx_market_rate: 7.8 },
    });
    expect(result.fx.rmbCosts).toBe(75);
    // 75/7.5 − 75/7.8 = 10 − 9.6154 = 0.3846
    expect(result.fx.gainEur).toBeCloseTo(0.3846, 4);
    // The FX gain is NOT folded into the margin total.
    expect(result.margin.total).toBe(5);
  });

  it("handles a parcel with no rate: everything zero, flagged, incomplete", () => {
    const result = computeVoltshipMargin({
      quantity: 2,
      client: null,
      factoryCostRmb: 90,
      carrierCostRmb: null,
      carrierCostSource: null,
      taxIncluded: true,
      settings,
    });
    expect(result.clientPays.total).toBe(0);
    expect(result.margin.pct).toBeNull();
    expect(result.margin.transport).toBeNull();
    expect(result.costs.taxPassThrough).toBe(0);
    expect(result.flags).toEqual(["no_rate", "carrier_cost_unknown"]);
    expect(result.complete).toBe(false);
  });
});

describe("sumMargins", () => {
  it("weights parcels and tracks real vs estimated and complete vs partial", () => {
    const a = computeVoltshipMargin({
      quantity: 1,
      client: clientBreakdown(1),
      factoryCostRmb: 45,
      carrierCostRmb: 30,
      carrierCostSource: "grid",
      taxIncluded: false,
      settings,
    });
    const b = computeVoltshipMargin({
      quantity: 1,
      client: clientBreakdown(1),
      factoryCostRmb: null,
      carrierCostRmb: 33,
      carrierCostSource: "real",
      taxIncluded: false,
      settings,
    });
    const totals = sumMargins([
      { margin: a, weight: 3 },
      { margin: b, weight: 1 },
      { margin: a, weight: 0 },
    ]);
    expect(totals.weight).toBe(4);
    expect(totals.revenue).toBe(18.5 * 4);
    expect(totals.margin).toBeCloseTo(5 * 3 + (6.5 - 4.4 - 3 + 0.5), 4);
    expect(totals.complete).toBe(3);
    expect(totals.incomplete).toBe(1);
    expect(totals.estimated).toBe(3);
    expect(totals.real).toBe(1);
    expect(totals.pct).toBeCloseTo(totals.margin / totals.revenue, 4);
  });

  it("returns an empty total for no items", () => {
    const totals = sumMargins([]);
    expect(totals.weight).toBe(0);
    expect(totals.pct).toBeNull();
    expect(totals.margin).toBe(0);
  });
});

describe("extractCarrierCostRmb", () => {
  it("sums shipping-like fee items", () => {
    expect(
      extractCarrierCostRmb({
        details: null,
        items: [
          { ft_code: "SHIPPING_FEE", amount: "31.20", currency_code: "RMB" },
          { ft_code: "OPF", amount: "2.00" },
          { ft_code: "FUEL_SURCHARGE_FREIGHT", amount: 1.3 },
        ],
      }),
    ).toBe(32.5);
  });

  it("falls back to shipping keys of fee_details and ignores totals", () => {
    expect(
      extractCarrierCostRmb({ details: { totalFee: "4.10", SHIPPING: "3.90", OPF: "0.20" }, items: null }),
    ).toBe(3.9);
  });

  it("returns null when no shipping line exists", () => {
    expect(extractCarrierCostRmb({ details: { OPF: "0.20" }, items: [{ ft_code: "OPF", amount: 1 }] })).toBeNull();
    expect(extractCarrierCostRmb(null)).toBeNull();
    expect(extractCarrierCostRmb("x")).toBeNull();
  });
});

describe("rmbToEur", () => {
  it("converts at the configured rate and rejects bad inputs", () => {
    expect(rmbToEur(75, 7.5)).toBe(10);
    expect(rmbToEur(null, 7.5)).toBeNull();
    expect(rmbToEur(75, 0)).toBeNull();
  });
});
