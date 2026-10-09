import { describe, expect, it } from "vitest";
import { keepAppMarkets } from "./keep-markets";

describe("keepAppMarkets", () => {
  it("keeps the store countries of an imported product, not the Airtable copy", () => {
    expect(keepAppMarkets({ destination_markets: "US" }, { destination_markets: "FR", notes: "x" }, true)).toEqual({
      destination_markets: "US",
      notes: "x",
    });
    expect(keepAppMarkets({ destination_markets: "US" }, { destination_markets: "FR" }, false)).toEqual({
      destination_markets: "FR",
    });
    expect(keepAppMarkets({}, { destination_markets: "FR" }, true)).toEqual({ destination_markets: "FR" });
  });
});
