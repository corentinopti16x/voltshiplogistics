import { describe, expect, it } from "vitest";
import {
  DEFAULT_PACKAGING_LADDER,
  calculateCogs,
  packagingWeightFor,
  parcelParts,
  parcelWeightG,
  type RateCell,
} from "./pricing";
import { boxPriceEur, parcelExtras, parseBoxField, productBox } from "../products/extras";
import { DEFAULT_PRICING_SETTINGS, parsePricingSettings } from "../pricing/settings";

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

describe("packaging and box", () => {
  it("adds the box per unit and the packaging once per parcel", () => {
    expect(parcelWeightG(90, 1)).toBe(90);
    expect(parcelWeightG(90, 1, { packagingWeightG: 20 })).toBe(110);
    expect(parcelWeightG(90, 2, { boxWeightG: 15, packagingWeightG: 20 })).toBe(230);
  });

  it("moves the parcel to the next bracket and bills the box with the product", () => {
    const base = { clientPrice: 2, weightG: 90, channel: "standard" as const, destination: "FR", cells, handlingFee: 1 };
    const plain = calculateCogs(base);
    expect(plain?.weightG).toBe(90);
    expect(plain?.shippingBase).toBe(4);
    const packed = calculateCogs({ ...base, packagingWeightG: 20 });
    expect(packed?.weightG).toBe(110);
    expect(packed?.shippingBase).toBe(5);
    expect(packed?.packagingWeightG).toBe(20);
    const boxed = calculateCogs({ ...base, packagingWeightG: 20, boxPrice: 0.4, boxWeightG: 40, quantity: 2 });
    // 2 × (90 + 40) + 20 = 280 g → 201–300 bracket
    expect(boxed?.weightG).toBe(280);
    expect(boxed?.shippingBase).toBe(7);
    expect(boxed?.box).toBe(0.8);
    // The box is packaging: not in the product line, no commission on it.
    expect(boxed?.product).toBe(4);
    expect(boxed?.cogs).toBe(12.95);
  });

  it("keeps the box out of the commission", () => {
    const withCommission = calculateCogs({
      clientPrice: 2,
      weightG: 90,
      channel: "standard",
      destination: "FR",
      cells,
      commissionPct: 10,
      boxPrice: 0.4,
      boxWeightG: 40,
    });
    expect(withCommission?.commission).toBe(0.2);
    expect(withCommission?.box).toBe(0.4);
    expect(withCommission?.cogs).toBe(7.6);
  });

  it("reads the box of a product and converts its price", () => {
    expect(productBox({})).toBeNull();
    expect(productBox({ box_price_rmb: null, box_weight_g: null })).toBeNull();
    expect(productBox({ box_price_rmb: 3, box_weight_g: 25 })).toEqual({ priceRmb: 3, weightG: 25 });
    expect(boxPriceEur({ priceRmb: 3, weightG: 25 }, 7.5)).toBe(0.4);
    const ladder = DEFAULT_PACKAGING_LADDER;
    expect(parcelExtras({ box_price_rmb: 3, box_weight_g: 25 }, { fx_rmb_per_eur: 7.5, packaging_ladder: ladder })).toEqual({
      boxPrice: 0.4,
      boxWeightG: 25,
      packagingWeightG: null,
      packagingLadder: ladder,
    });
    expect(parcelExtras({ packaging_weight_g: 40 }, { fx_rmb_per_eur: 7.5, packaging_ladder: ladder }).packagingWeightG).toBe(40);
    expect(parseBoxField("")).toBeNull();
    expect(parseBoxField("2,5")).toBe(2.5);
    expect(Number.isNaN(parseBoxField("-1"))).toBe(true);
  });

  it("grows the packaging with the parcel contents", () => {
    expect(DEFAULT_PRICING_SETTINGS.packaging_ladder).toEqual(DEFAULT_PACKAGING_LADDER);
    expect(packagingWeightFor(150, DEFAULT_PACKAGING_LADDER)).toBe(20);
    expect(packagingWeightFor(200, DEFAULT_PACKAGING_LADDER)).toBe(20);
    expect(packagingWeightFor(201, DEFAULT_PACKAGING_LADDER)).toBe(25);
    expect(packagingWeightFor(900, DEFAULT_PACKAGING_LADDER)).toBe(30);
    expect(packagingWeightFor(3000, DEFAULT_PACKAGING_LADDER)).toBe(35);
    // 2 × 125 g = 250 g of contents → 25 g packaging; a product override wins.
    expect(parcelParts(125, 2, { packagingLadder: DEFAULT_PACKAGING_LADDER })).toEqual({ contentG: 250, packagingG: 25, totalG: 275 });
    expect(parcelParts(125, 2, { packagingLadder: DEFAULT_PACKAGING_LADDER, packagingWeightG: 40 }).packagingG).toBe(40);
    const cogs = calculateCogs({
      clientPrice: 2, weightG: 90, channel: "standard", destination: "FR", cells, packagingLadder: DEFAULT_PACKAGING_LADDER,
    });
    expect(cogs?.contentWeightG).toBe(90);
    expect(cogs?.packagingWeightG).toBe(20);
    expect(cogs?.weightG).toBe(110);
  });

  it("parses the packaging ladder setting", () => {
    expect(parsePricingSettings({}).packaging_ladder).toEqual(DEFAULT_PACKAGING_LADDER);
    expect(
      parsePricingSettings({ packaging_ladder: [{ upToG: null, weightG: 40 }, { upToG: 300, weightG: 22 }] }).packaging_ladder,
    ).toEqual([
      { upToG: 300, weightG: 22 },
      { upToG: null, weightG: 40 },
    ]);
    expect(parsePricingSettings({ packaging_ladder: [{ upToG: 300, weightG: 22 }] }).packaging_ladder).toEqual([
      { upToG: 300, weightG: 22 },
      { upToG: null, weightG: 22 },
    ]);
  });
});
