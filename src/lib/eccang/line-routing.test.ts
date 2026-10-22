import { describe, expect, it } from "vitest";
import { DEFAULT_PACKAGING_LADDER } from "../domain/pricing";
import {
  exactShippingMethod,
  lineForShippingMethod,
  parcelFactsFromRow,
  parcelFromItems,
  type ParcelProduct,
} from "./line-routing";

const map = {
  "YunExpress|商派特惠带电 YTSPTHDD": "US_BAT_YTSP",
  "YunExpress|特惠带电 THZXR": "US_BAT_YTTH",
  Tongyou: "TY_US",
  default: "US_BAT_YTSP",
};

describe("lineForShippingMethod", () => {
  it("finds the grid line of an ECCANG method code (case-insensitive), never the default fallback", () => {
    expect(lineForShippingMethod(map, "us_bat_ytth")).toEqual({ carrier: "YunExpress", lineName: "特惠带电 THZXR" });
    expect(lineForShippingMethod(map, "US_BAT_YTSP")).toEqual({ carrier: "YunExpress", lineName: "商派特惠带电 YTSPTHDD" });
    expect(lineForShippingMethod(map, "TY_US")).toEqual({ carrier: "Tongyou", lineName: null });
    expect(lineForShippingMethod(map, "UNKNOWN")).toBeNull();
    expect(lineForShippingMethod(map, null)).toBeNull();
  });

  it("maps a planned line to its own method only (no carrier or default fallback)", () => {
    expect(exactShippingMethod(map, { carrier: "YunExpress", lineName: "商派特惠带电 YTSPTHDD" })).toBe("US_BAT_YTSP");
    expect(exactShippingMethod(map, { carrier: "yunexpress", lineName: "特惠带电 THZXR" })).toBe("US_BAT_YTTH");
    expect(exactShippingMethod(map, { carrier: "YunExpress", lineName: "化妆品" })).toBeNull();
    expect(exactShippingMethod(map, { carrier: "Tongyou", lineName: null })).toBe("TY_US");
    expect(exactShippingMethod(map, { carrier: "Tongyou", lineName: "美国专线带电" })).toBeNull();
  });
});

describe("parcelFactsFromRow", () => {
  it("reads an ECCANG record (getOrderList)", () => {
    const facts = parcelFactsFromRow({
      shipping_method: "US_BAT_YTTH",
      billed_weight_g: null,
      last_payload: {
        consignee_country_code: "us",
        consigne_zipcode: "10001-2233",
        order_weight: "0.118",
        items: [
          { product_sku: "SMART-VOICE-LANGUAGE-COMPANION", quantity: "2" },
          { product_sku: "US-TRANSLATOR-CASE-01", quantity: 2 },
        ],
      },
    });
    expect(facts).toEqual({
      country: "US",
      zip: "10001-2233",
      billedWeightG: 118,
      items: [
        { sku: "SMART-VOICE-LANGUAGE-COMPANION", quantity: 2 },
        { sku: "US-TRANSLATOR-CASE-01", quantity: 2 },
      ],
      shippingMethod: "US_BAT_YTTH",
    });
  });

  it("falls back on the Shopify order kept on a blocked row", () => {
    const facts = parcelFactsFromRow({
      last_payload: {
        shopify_order: {
          shipping_address: { country_code: "US", zip: "94501" },
          line_items: [
            { sku: "SMART-VOICE-LANGUAGE-COMPANION", quantity: 1 },
            { sku: "TIP", quantity: 1, requires_shipping: false },
          ],
        },
      },
    });
    expect(facts.country).toBe("US");
    expect(facts.zip).toBe("94501");
    expect(facts.items).toEqual([{ sku: "SMART-VOICE-LANGUAGE-COMPANION", quantity: 1 }]);
    expect(facts.billedWeightG).toBeNull();
    expect(facts.shippingMethod).toBeNull();
  });
});

describe("parcelFromItems", () => {
  const products = new Map<string, ParcelProduct>([
    ["T", { weightG: 106, pieces: 1, channel: "electronics_battery", batteryInternal: true, boxWeightG: 0, packagingWeightG: 14 }],
    ["C", { weightG: 40, pieces: 1, channel: "standard", batteryInternal: false, boxWeightG: 0, packagingWeightG: null }],
    ["SET2", { weightG: 80, pieces: 2, channel: "standard", batteryInternal: false, boxWeightG: 0, packagingWeightG: null }],
    ["W", { weightG: 85, pieces: 1, channel: "electronics_battery", batteryInternal: false, boxWeightG: 0, packagingWeightG: null }],
  ]);

  it("weighs 2 translators + 2 cases like the app (292 g + 25 g packaging), battery line, built-in battery", () => {
    const parcel = parcelFromItems([{ sku: "T", quantity: 2 }, { sku: "C", quantity: 2 }], products, DEFAULT_PACKAGING_LADDER);
    expect(parcel).toEqual({
      weightG: 317,
      channel: "electronics_battery",
      batteryInternal: true,
      missing: [],
      lead: "T",
      singleUnits: null,
    });
  });

  it("uses the product's own packaging for a single-product parcel (1 translator = 120 g)", () => {
    expect(parcelFromItems([{ sku: "T", quantity: 1 }], products, DEFAULT_PACKAGING_LADDER)).toMatchObject({
      weightG: 120,
      lead: "T",
      singleUnits: 1,
    });
    expect(parcelFromItems([{ sku: "T", quantity: 1 }, { sku: "C", quantity: 1 }], products, DEFAULT_PACKAGING_LADDER).weightG).toBe(166);
  });

  it("counts pieces of a set (ECCANG lines are pieces) and flags unknown SKUs", () => {
    const parcel = parcelFromItems([{ sku: "SET2", quantity: 2 }, { sku: "X", quantity: 1 }], products, DEFAULT_PACKAGING_LADDER);
    expect(parcel.weightG).toBe(100);
    expect(parcel.missing).toEqual(["X"]);
    // 4 pieces of a set of 2 = 2 units sold.
    expect(parcelFromItems([{ sku: "SET2", quantity: 4 }], products, DEFAULT_PACKAGING_LADDER).singleUnits).toBe(2);
  });

  it("leads with the battery item even when a standard item comes first", () => {
    expect(parcelFromItems([{ sku: "C", quantity: 1 }, { sku: "T", quantity: 1 }], products, DEFAULT_PACKAGING_LADDER).lead).toBe("T");
  });

  it("does not allow built-in-battery lines when one battery item has a removable battery", () => {
    const parcel = parcelFromItems([{ sku: "T", quantity: 1 }, { sku: "W", quantity: 1 }], products, DEFAULT_PACKAGING_LADDER);
    expect(parcel.batteryInternal).toBe(false);
  });
});
