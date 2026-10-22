import { describe, expect, it } from "vitest";
import { DEFAULT_PACKAGING_LADDER, calculateBundleCogs, calculateCogs, parcelChannel, parcelLead, type RateCell } from "./pricing";

const cell = (min: number, max: number, price: number): RateCell => ({
  gridVersion: "V3",
  carrier: "YunExpress",
  destination: "FR",
  channel: "standard",
  weightMinG: min,
  weightMaxG: max,
  price,
  deliveryRange: null,
  lineName: "商派",
  iossRequired: false,
  carrierCostRmb: null,
});
const cells = [cell(1, 100, 4), cell(101, 150, 5), cell(151, 200, 6), cell(201, 300, 7)];
const base = { channel: "standard" as const, destination: "FR", cells, handlingFee: 1, packagingLadder: DEFAULT_PACKAGING_LADDER };
const translator = { productId: "main", title: "Traducteur", clientPrice: 2, weightG: 90 };
const pouch = { productId: "pouch", title: "Pochette", clientPrice: 0.5, weightG: 20 };

describe("calculateBundleCogs (main product + upsells in one parcel)", () => {
  it("ships everything at the total weight, packaging once, handling for all the units", () => {
    const bundle = calculateBundleCogs({ ...base, items: [{ ...translator, quantity: 1 }, { ...pouch, quantity: 2 }] });
    // 90 + 2 × 20 = 130 g of products + 20 g packaging = 150 g → 101–150 bracket.
    expect(bundle?.contentWeightG).toBe(130);
    expect(bundle?.packagingWeightG).toBe(20);
    expect(bundle?.weightG).toBe(150);
    expect(bundle?.shipping).toBe(5);
    expect(bundle?.product).toBe(3);
    expect(bundle?.units).toBe(3);
    const threeUnits = calculateCogs({ ...base, clientPrice: 1, weightG: 40, quantity: 3 });
    expect(bundle?.handling).toBe(threeUnits?.handling);
    expect(bundle?.cogs).toBe(Math.round((3 + 5 + (threeUnits?.handling ?? 0)) * 100) / 100);
    expect(bundle?.items.map((item) => item.product)).toEqual([2, 1]);
  });

  it("gives the same COGS as calculateCogs for the main product alone", () => {
    const alone = calculateBundleCogs({ ...base, commissionPct: 5, items: [{ ...translator, quantity: 2 }] });
    const cogs = calculateCogs({ ...base, commissionPct: 5, clientPrice: 2, weightG: 90, quantity: 2 });
    expect(alone?.cogs).toBe(cogs?.cogs);
    expect(alone?.weightG).toBe(cogs?.weightG);
    expect(alone?.commission).toBe(cogs?.commission);
  });

  it("keeps boxes at cost, out of the commission", () => {
    const bundle = calculateBundleCogs({
      ...base,
      commissionPct: 10,
      items: [{ ...translator, quantity: 1, boxPrice: 0.4, boxWeightG: 30 }, { ...pouch, quantity: 1 }],
    });
    expect(bundle?.box).toBe(0.4);
    expect(bundle?.contentWeightG).toBe(140);
    expect(bundle?.commission).toBe(0.25);
  });

  it("uses the product's own packaging as a minimum when upsells are added", () => {
    const bundle = calculateBundleCogs({ ...base, packagingFloorG: 32, items: [{ ...translator, quantity: 1 }, { ...pouch, quantity: 1 }] });
    expect(bundle?.packagingWeightG).toBe(32);
    const fixed = calculateBundleCogs({ ...base, packagingWeightG: 15, items: [{ ...translator, quantity: 1 }] });
    expect(fixed?.packagingWeightG).toBe(15);
  });

  it("returns null without any unit", () => {
    expect(calculateBundleCogs({ ...base, items: [{ ...translator, quantity: 0 }] })).toBeNull();
  });
});

describe("parcelChannel", () => {
  it("ships the parcel on the most constraining channel", () => {
    expect(parcelChannel(["standard", "electronics_battery"])).toBe("electronics_battery");
    expect(parcelChannel(["liquid_perfume", "standard"])).toBe("cosmetics");
    expect(parcelChannel(["magnetic", "standard"])).toBe("magnetic");
    expect(parcelChannel(["cosmetics", "standard"])).toBe("cosmetics");
    expect(parcelChannel(["electronics_battery", "magnetic", "standard"])).toBe("electronics_battery");
    expect(parcelChannel(["standard", "sensitive_other", "cosmetics"])).toBe("sensitive_other");
    expect(parcelChannel(["electronics_battery", "sensitive_other"])).toBe("sensitive_other");
    expect(parcelChannel([null, undefined])).toBeNull();
  });

  it("moves cosmetics mixed with a battery or magnetic item to the sensitive line", () => {
    expect(parcelChannel(["electronics_battery", "cosmetics"])).toBe("sensitive_other");
    expect(parcelChannel(["liquid_perfume", "electronics_battery", "standard"])).toBe("sensitive_other");
    expect(parcelChannel(["magnetic", "cosmetics"])).toBe("sensitive_other");
  });
});

describe("parcelLead", () => {
  const caseItem = { id: "case", shipping_channel: "standard" };
  const translatorItem = { id: "translator", shipping_channel: "electronics_battery" };

  it("lets the battery item lead even when a standard item comes first", () => {
    expect(parcelLead([caseItem, translatorItem])).toEqual({ lead: translatorItem, channel: "electronics_battery" });
    expect(parcelLead([translatorItem, caseItem])).toEqual({ lead: translatorItem, channel: "electronics_battery" });
  });

  it("puts a battery + cosmetics parcel on the sensitive line, led by the battery item", () => {
    const cream = { id: "cream", shipping_channel: "cosmetics" };
    expect(parcelLead([cream, translatorItem])).toEqual({ lead: translatorItem, channel: "sensitive_other" });
  });

  it("lets a sensitive item lead over a battery item", () => {
    const supplement = { id: "supplement", shipping_channel: "sensitive_other" };
    expect(parcelLead([translatorItem, supplement])).toEqual({ lead: supplement, channel: "sensitive_other" });
  });

  it("keeps the first item when every item is on the same line", () => {
    const other = { id: "other", shipping_channel: "standard" };
    expect(parcelLead([caseItem, other])).toEqual({ lead: caseItem, channel: "standard" });
  });

  it("counts a product without channel as standard and maps liquids to cosmetics", () => {
    const bare = { id: "bare", shipping_channel: null };
    const perfume = { id: "perfume", shipping_channel: "liquid_perfume" };
    expect(parcelLead([bare])).toEqual({ lead: bare, channel: "standard" });
    expect(parcelLead([bare, perfume])).toEqual({ lead: perfume, channel: "cosmetics" });
    expect(parcelLead([])).toBeNull();
  });
});
