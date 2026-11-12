import { describe, expect, it } from "vitest";
import { fillEmptyFromAirtable, mergeQuoteAppFirst } from "./app-wins";

describe("fillEmptyFromAirtable", () => {
  it("never overwrites a value the app already has", () => {
    expect(
      fillEmptyFromAirtable(
        { weight_g: 560, sku: "LNG-SHAPE-1", shipping_channel: null, title: "SHAPE" },
        { weight_g: 520, sku: "OLD", shipping_channel: "standard", title: "Shape (Airtable)" },
      ),
    ).toEqual({ shipping_channel: "standard" });
  });

  it("ignores empty Airtable cells and protected columns", () => {
    expect(
      fillEmptyFromAirtable(
        { moq: null, client_id: "a" },
        { moq: "", client_id: "b", id: "x", quote_json: { a: 1 }, photo_url: "u" },
      ),
    ).toEqual({});
  });
});

describe("mergeQuoteAppFirst", () => {
  it("keeps the app's keys and adds what only Airtable has", () => {
    expect(
      mergeQuoteAppFirst(
        { _carrier_pref: { US: "x" }, notes: "", factory: 12 },
        { factory: 10, notes: "from airtable", extra: true },
      ),
    ).toEqual({ _carrier_pref: { US: "x" }, notes: "from airtable", factory: 12, extra: true });
  });
});
