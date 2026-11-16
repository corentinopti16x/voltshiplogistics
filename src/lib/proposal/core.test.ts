import { describe, expect, it } from "vitest";
import { cleanProposalItem, cleanProposalMarkets } from "./core";

const base = { name: " Veilleuse ", price: "46,5", currency: "rmb" as const, weightG: "380", channel: "standard" };

describe("cleanProposalItem", () => {
  it("converts a factory price in yuan to euros", () => {
    expect(cleanProposalItem(base, 7.5)).toEqual({ name: "Veilleuse", priceEur: 6.2, weightG: 380, channel: "standard" });
  });
  it("keeps a price already in euros", () => {
    expect(cleanProposalItem({ ...base, price: "6.2", currency: "eur" }, 7.5)?.priceEur).toBe(6.2);
  });
  it("rejects a line with a missing value or an unknown type", () => {
    expect(cleanProposalItem({ ...base, name: " " }, 7.5)).toBeNull();
    expect(cleanProposalItem({ ...base, weightG: "0" }, 7.5)).toBeNull();
    expect(cleanProposalItem({ ...base, price: "abc" }, 7.5)).toBeNull();
    expect(cleanProposalItem({ ...base, channel: "rocket" }, 7.5)).toBeNull();
    expect(cleanProposalItem(base, 0)).toBeNull();
  });
});

describe("cleanProposalMarkets", () => {
  it("keeps known countries once, in the order chosen", () => {
    expect(cleanProposalMarkets(["us", "FR", "US", "ZZ", ""], ["FR", "US", "DE"])).toEqual(["US", "FR"]);
  });
});
