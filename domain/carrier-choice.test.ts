import { describe, expect, it } from "vitest";
import {
  calculateCogs,
  lineKey,
  listRateOptions,
  parseAcceptedQuoteSnapshot,
  selectRateCell,
  type RateCell,
} from "./pricing";
import {
  allowedLinesFromRules,
  carrierLineLabel,
  parseCarrierPreferences,
  parseCarrierRules,
  parseLineKey,
  resolveCarrierSelection,
} from "./carrier-rules";

const grid = "2026-10-01.1";
const cell = (
  carrier: string,
  lineName: string | null,
  weightMinG: number,
  weightMaxG: number,
  price: number,
  extra: Partial<RateCell> = {},
): RateCell => ({
  gridVersion: grid,
  carrier,
  destination: "FR",
  channel: "standard",
  weightMinG,
  weightMaxG,
  price,
  lineName,
  ...extra,
});

const cells: RateCell[] = [
  cell("YunExpress", "CHC", 0, 500, 3.9, { deliveryRange: "8–12 j", iossRequired: true }),
  cell("YunExpress", "THPHR-CHC", 0, 500, 4.4, { deliveryRange: "6–9 j" }),
  cell("4PX", "Standard", 0, 500, 4.1, { deliveryRange: "10–15 j" }),
  cell("Huahan", "Eco", 0, 300, 3.5, { deliveryRange: "12–18 j" }),
  // Only YunExpress CHC and 4PX go above 500 g.
  cell("YunExpress", "CHC", 501, 1000, 6.5),
  cell("4PX", "Standard", 501, 1000, 6.9),
];

const base = { clientPrice: 2, weightG: 420, channel: "standard" as const, destination: "FR", cells };

describe("carrier line choice — engine", () => {
  it("lists every line able to ship the parcel, cheapest first, one per carrier + line", () => {
    const options = listRateOptions(cells, { weightG: 420, channel: "standard", destination: "FR" });
    expect(options.map((option) => `${lineKey(option.carrier, option.lineName)}:${option.price}`)).toEqual([
      "YunExpress|CHC:3.9",
      "4PX|Standard:4.1",
      "YunExpress|THPHR-CHC:4.4",
    ]);
    expect(options[0]).toMatchObject({
      deliveryRange: "8–12 j",
      iossRequired: true,
      weightMinG: 0,
      weightMaxG: 500,
      billedWeightG: 420,
    });
  });

  it("hides blocked lines from the options", () => {
    const allowed = allowedLinesFromRules(cells, parseCarrierRules({ blocked: ["YunExpress|CHC"] }));
    const options = listRateOptions(cells, { ...base, allowedLines: allowed });
    expect(options.map((option) => option.carrier + "|" + option.lineName)).toEqual([
      "4PX|Standard",
      "YunExpress|THPHR-CHC",
    ]);
  });

  it("picks the cheapest line without a preference", () => {
    const result = calculateCogs(base);
    expect(result).toMatchObject({ carrier: "YunExpress", lineName: "CHC", shippingBase: 3.9, selectionReason: "cheapest" });
  });

  it("applies the preferred line when it has a bracket at this weight", () => {
    const result = calculateCogs({ ...base, carrierPreference: { carrier: "YunExpress", lineName: "THPHR-CHC" } });
    expect(result).toMatchObject({
      carrier: "YunExpress",
      lineName: "THPHR-CHC",
      shippingBase: 4.4,
      deliveryRange: "6–9 j",
      selectionReason: "preferred",
    });
  });

  it("falls back to the cheapest line when the preferred one has no bracket at this weight", () => {
    const result = calculateCogs({
      ...base,
      weightG: 400,
      quantity: 2, // 800 g: THPHR-CHC stops at 500 g
      carrierPreference: { carrier: "YunExpress", lineName: "THPHR-CHC" },
    });
    expect(result).toMatchObject({
      carrier: "YunExpress",
      lineName: "CHC",
      shippingBase: 6.5,
      selectionReason: "fallback_preferred_unavailable",
    });
  });

  it("never picks a blocked line, even when preferred or cheapest", () => {
    const allowed = allowedLinesFromRules(
      cells,
      parseCarrierRules({ blocked: ["YunExpress|CHC", "Huahan|Eco"] }),
    );
    const cheapest = calculateCogs({ ...base, allowedLines: allowed });
    expect(cheapest).toMatchObject({ carrier: "4PX", lineName: "Standard", selectionReason: "cheapest" });

    const preferredBlocked = calculateCogs({
      ...base,
      allowedLines: allowed,
      carrierPreference: { carrier: "YunExpress", lineName: "CHC" },
    });
    expect(preferredBlocked).toMatchObject({ carrier: "4PX", selectionReason: "fallback_preferred_unavailable" });

    const everythingBlocked = allowedLinesFromRules(
      cells,
      parseCarrierRules({ blocked: cells.map((c) => lineKey(c.carrier, c.lineName)) }),
    );
    expect(calculateCogs({ ...base, allowedLines: everythingBlocked })).toBeNull();
  });

  it("matches a legacy preference without a line name", () => {
    const legacy = [cell("YunExpress", null, 0, 500, 3.9), cell("4PX", null, 0, 500, 3.0)];
    expect(
      selectRateCell(legacy, {
        weightG: 420,
        channel: "standard",
        destination: "FR",
        carrierPreference: { carrier: "YunExpress", lineName: null },
      }),
    ).toMatchObject({ reason: "preferred", cell: { carrier: "YunExpress" } });
  });

  it("keeps the selection reason in a frozen snapshot and defaults to cheapest for old ones", () => {
    const result = calculateCogs({ ...base, carrierPreference: { carrier: "4PX", lineName: "Standard" } });
    const parsed = parseAcceptedQuoteSnapshot({ ...result, acceptedAt: "2026-10-01T00:00:00.000Z" });
    expect(parsed?.selectionReason).toBe("preferred");
    const old = parseAcceptedQuoteSnapshot({
      ...result,
      selectionReason: undefined,
      acceptedAt: "2026-10-01T00:00:00.000Z",
    });
    expect(old?.selectionReason).toBe("cheapest");
  });
});

describe("carrier line choice — rules parsing", () => {
  it("parses admin rules, dropping malformed entries", () => {
    const rules = parseCarrierRules({
      blocked: ["YunExpress|THPHR-CHC", "nokey", 3, "YunExpress|THPHR-CHC"],
      forced: {
        fr: { carrier: "4PX", lineName: "Standard" },
        de: { carrier: "" },
        "united states": { carrier: "YunExpress", lineName: "" },
      },
    });
    expect(rules.blocked).toEqual(["YunExpress|THPHR-CHC"]);
    expect(rules.forced).toEqual({
      FR: { carrier: "4PX", lineName: "Standard" },
      US: { carrier: "YunExpress", lineName: null },
    });
    expect(parseCarrierRules(null)).toEqual({ blocked: [], forced: {} });
    expect(parseCarrierRules("x")).toEqual({ blocked: [], forced: {} });
  });

  it("parses the product preference from quote_json._carrier_pref", () => {
    expect(
      parseCarrierPreferences({
        _request: {},
        _carrier_pref: { FR: { carrier: "YunExpress", lineName: "CHC" }, DE: null, XX: { lineName: "x" } },
      }),
    ).toEqual({ FR: { carrier: "YunExpress", lineName: "CHC" } });
    expect(parseCarrierPreferences({ _carrier_pref: null })).toEqual({});
    expect(parseCarrierPreferences(null)).toEqual({});
  });

  it("forced line beats the client's choice; a blocked choice is ignored", () => {
    const rules = parseCarrierRules({
      blocked: ["YunExpress|CHC"],
      forced: { DE: { carrier: "4PX", lineName: "Standard" } },
    });
    const prefs = { FR: { carrier: "YunExpress", lineName: "CHC" }, DE: { carrier: "Huahan", lineName: "Eco" } };
    expect(resolveCarrierSelection(rules, prefs, "DE")).toEqual({
      preference: { carrier: "4PX", lineName: "Standard" },
      forced: true,
    });
    expect(resolveCarrierSelection(rules, prefs, "FR")).toEqual({ preference: null, forced: false });
    expect(resolveCarrierSelection({ blocked: [], forced: {} }, prefs, "fr")).toEqual({
      preference: { carrier: "YunExpress", lineName: "CHC" },
      forced: false,
    });
  });

  it("round-trips line keys and labels", () => {
    expect(parseLineKey("YunExpress|THPHR-CHC")).toEqual({ carrier: "YunExpress", lineName: "THPHR-CHC" });
    expect(parseLineKey("YunExpress|")).toEqual({ carrier: "YunExpress", lineName: null });
    expect(parseLineKey("|x")).toBeNull();
    expect(carrierLineLabel({ carrier: "YunExpress", lineName: "CHC" })).toBe("YunExpress CHC");
    expect(carrierLineLabel({ carrier: "4PX", lineName: null })).toBe("4PX");
    expect(allowedLinesFromRules(cells, { blocked: [], forced: {} })).toBeNull();
  });
});
