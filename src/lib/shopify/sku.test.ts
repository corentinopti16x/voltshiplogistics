import { describe, expect, it } from "vitest";
import { effectiveSku, fallbackVariantSku, isFallbackSku } from "./sku";

describe("shopify sku fallback", () => {
  it("keeps a real SKU", () => {
    expect(effectiveSku(" MAG-01 ", 123)).toBe("MAG-01");
  });
  it("falls back to the variant id", () => {
    expect(effectiveSku("", 456)).toBe("SHOPIFY-456");
    expect(effectiveSku(null, "789")).toBe("SHOPIFY-789");
    expect(isFallbackSku("SHOPIFY-789")).toBe(true);
  });
  it("returns null without SKU nor variant", () => {
    expect(effectiveSku(null, null)).toBeNull();
    expect(fallbackVariantSku("")).toBeNull();
  });
});

import { cacheOrderLines } from "./order-cache";

describe("order lines without SKU", () => {
  it("keeps lines without SKU under their variant fallback", () => {
    expect(
      cacheOrderLines([
        { sku: "", variant_id: 42, quantity: 2, title: "Lamp" },
        { sku: "REAL", variant_id: 43, quantity: 1 },
        { sku: null, quantity: 1 },
      ]),
    ).toEqual([
      { sku: "SHOPIFY-42", quantity: 2, title: "Lamp" },
      { sku: "REAL", quantity: 1 },
    ]);
  });
});
