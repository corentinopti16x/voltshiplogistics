import { describe, expect, it } from "vitest";
import { calculateCogs, parcelWeightG, type RateCell } from "./pricing";
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
    expect(parcelExtras({ box_price_rmb: 3, box_weight_g: 25 }, { fx_rmb_per_eur: 7.5, packaging_weight_g: 20 })).toEqual({
      boxPrice: 0.4,
      boxWeightG: 25,
      packagingWeightG: 20,
    });
    expect(parseBoxField("")).toBeNull();
    expect(parseBoxField("2,5")).toBe(2.5);
    expect(Number.isNaN(parseBoxField("-1"))).toBe(true);
  });

  it("defaults the packaging setting to 20 g and keeps saved values", () => {
    expect(DEFAULT_PRICING_SETTINGS.packaging_weight_g).toBe(20);
    expect(parsePricingSettings({}).packaging_weight_g).toBe(20);
    expect(parsePricingSettings({ packaging_weight_g: 0 }).packaging_weight_g).toBe(0);
    expect(parsePricingSettings({ packaging_weight_g: 35 }).packaging_weight_g).toBe(35);
  });
});
