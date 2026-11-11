import { describe, expect, it } from "vitest";
import type { RateCell } from "../domain/pricing";
import {
  summarizeCountries,
  summarizeTransportLines,
  withoutClientPrices,
} from "./transport-view";

function cell(over: Partial<RateCell>): RateCell {
  return {
    gridVersion: "V1",
    carrier: "YunExpress",
    destination: "US",
    channel: "electronics_battery",
    weightMinG: 1,
    weightMaxG: 2000,
    price: 5,
    lineName: "THZXR",
    carrierCostRmb: 40,
    ...over,
  };
}

const noMethod = () => null;

describe("summarizeTransportLines", () => {
  it("keeps only the lines of the selected channel and lists every channel they accept", () => {
    const cells = [
      cell({}),
      cell({ carrier: "Tongyou", lineName: "特敏感", channel: "cosmetics" }),
      cell({ carrier: "Huahan", lineName: "PK0590", carrierCostRmb: 30 }),
    ];
    const lines = summarizeTransportLines(
      cells,
      "electronics_battery",
      [
        {
          carrier: "YunExpress",
          lineName: "THZXR",
          channel: "electronics_battery",
        },
        { carrier: "YunExpress", lineName: "THZXR", channel: "standard" },
        {
          carrier: "Huahan",
          lineName: "PK0590",
          channel: "electronics_battery",
        },
      ],
      noMethod,
    );
    expect(lines.map((line) => line.key)).toEqual([
      "Huahan|PK0590",
      "YunExpress|THZXR",
    ]);
    expect(lines[1].channels).toEqual(["standard", "electronics_battery"]);
  });

  it("prices each sample weight at the exact gram and marks the cheapest line per weight", () => {
    const grams = (from: number, to: number, perGram: number, fixed: number) =>
      Array.from(
        { length: to - from + 1 },
        (_, index) =>
          Math.round(((from + index) * perGram + fixed) * 100) / 100,
      );
    const cells = [
      cell({
        gramCostsRmb: grams(1, 2000, 0.102, 21),
        gramPrices: grams(1, 2000, 0.0136, 3.4),
      }),
      cell({
        carrier: "Huahan",
        lineName: "PK0590",
        weightMaxG: 400,
        gramCostsRmb: grams(1, 400, 0.08, 20),
      }),
    ];
    const [first, second] = summarizeTransportLines(
      cells,
      "electronics_battery",
      [],
      noMethod,
    );
    expect(first.key).toBe("Huahan|PK0590");
    expect(first.samples.map((sample) => sample.costRmb)).toEqual([
      28,
      44,
      null,
      null,
    ]);
    expect(second.samples.map((sample) => sample.costRmb)).toEqual([
      31.2, 51.6, 72, 123,
    ]);
    expect(first.samples.map((sample) => sample.cheapest)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(second.samples.map((sample) => sample.cheapest)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(first.maxG).toBe(400);
  });

  it("treats liquid_perfume as cosmetics and reports the linked ECCANG method", () => {
    const lines = summarizeTransportLines(
      [
        cell({
          carrier: "Tongyou",
          lineName: "TK特货",
          channel: "cosmetics",
          destination: "FR",
          deliveryRange: "9-12",
        }),
      ],
      "liquid_perfume",
      [{ carrier: "Tongyou", lineName: "TK特货", channel: "liquid_perfume" }],
      (carrier, lineName) =>
        carrier === "Tongyou" && lineName === "TK特货" ? "EU_SPE_TK" : null,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].channels).toEqual(["cosmetics"]);
    expect(lines[0].eccangMethod).toBe("EU_SPE_TK");
    expect(lines[0].deliveryRange).toBe("9-12");
  });

  it("hides the client prices for non-admins but keeps the carrier costs and the cheapest marks", () => {
    const cells = [
      cell({}),
      cell({
        carrier: "Huahan",
        lineName: "PK0590",
        weightMaxG: 400,
        carrierCostRmb: 30,
      }),
    ];
    const team = withoutClientPrices(
      summarizeTransportLines(cells, "electronics_battery", [], noMethod),
    );
    expect(
      team.flatMap((line) => line.samples.map((sample) => sample.price)),
    ).toEqual(Array(8).fill(null));
    expect(team[0].samples.map((sample) => sample.costRmb)).toEqual([
      30,
      30,
      null,
      null,
    ]);
    expect(team[0].samples.map((sample) => sample.cheapest)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(JSON.stringify(team)).not.toMatch(/"price":\d/);
  });

  it("puts pending lines last, never marks them cheapest, and applies the per-country settings", () => {
    const cells = [
      cell({}),
      cell({ carrier: "Huahan", lineName: "PK0590", carrierCostRmb: 30 }),
    ];
    const settings = new Map([
      [
        "US|huahan|pk0590",
        {
          destination: "US",
          carrier: "Huahan",
          lineName: "PK0590",
          status: "pending" as const,
          eccangMethod: "US_BAT_HHNE",
          deliveryDays: "10-15",
          note: "Test à faire",
          updatedAt: null,
        },
      ],
    ]);
    const lines = summarizeTransportLines(
      cells,
      "electronics_battery",
      [],
      noMethod,
      settings,
    );
    expect(lines.map((line) => `${line.carrier}:${line.status}`)).toEqual([
      "YunExpress:active",
      "Huahan:pending",
    ]);
    expect(lines[1].samples.some((sample) => sample.cheapest)).toBe(false);
    expect(lines[0].samples.every((sample) => sample.cheapest)).toBe(true);
    expect(lines[1]).toMatchObject({
      eccangMethod: "US_BAT_HHNE",
      deliveryRange: "10-15",
      note: "Test à faire",
    });
  });

  it("returns no line when the country has nothing in the channel", () => {
    expect(
      summarizeTransportLines([cell({})], "magnetic", [], noMethod),
    ).toEqual([]);
  });
});

describe("summarizeCountries", () => {
  const row = (
    destination: string,
    carrier: string,
    lineName: string,
    channel: string,
    hasDelivery = false,
  ) => ({ destination, carrier, lineName, channel, hasDelivery });
  const rows = [
    row("US", "YunExpress", "A", "standard", true),
    row("US", "YunExpress", "A", "electronics_battery", true),
    row("US", "Huahan", "B", "standard"),
    row("US", "Tongyou", "C", "cosmetics"),
    row("FR", "4PX", "D", "standard", true),
  ];
  const settings = new Map([
    [
      "US|tongyou|c",
      {
        destination: "US",
        carrier: "Tongyou",
        lineName: "C",
        status: "pending" as const,
        eccangMethod: null,
        deliveryDays: null,
        note: null,
        updatedAt: null,
      },
    ],
  ]);
  const needs = new Map([
    ["US|standard", 12],
    ["US|cosmetics", 3],
    ["CA|standard", 2],
  ]);
  const result = summarizeCountries(
    rows,
    needs,
    (carrier) => (carrier === "YunExpress" ? "US_YT" : null),
    settings,
  );
  const of = (code: string) => result.find((item) => item.code === code);
  const cellOf = (code: string, channel: string) =>
    of(code)?.cells.find((item) => item.channel === channel);

  it("counts the open lines per product type", () => {
    expect(cellOf("US", "standard")).toMatchObject({
      active: 2,
      pending: 0,
      products: 12,
      blocked: false,
    });
  });

  it("blocks a product type whose only line is not open", () => {
    expect(cellOf("US", "cosmetics")).toMatchObject({
      active: 0,
      pending: 1,
      blocked: true,
    });
  });

  it("adds a country products are sold to even without any line", () => {
    expect(of("CA")?.lines).toBe(0);
    expect(cellOf("CA", "standard")?.blocked).toBe(true);
  });

  it("counts open lines without an ECCANG line or a delivery time once each", () => {
    expect(of("US")).toMatchObject({ lines: 2, unlinked: 1, noDelivery: 1 });
    expect(of("FR")).toMatchObject({ lines: 1, unlinked: 1, noDelivery: 0 });
  });

  it("puts the countries where something cannot ship first", () => {
    expect(result.map((item) => item.code)).toEqual(["US", "CA", "FR"]);
  });
});
