import { describe, expect, it } from "vitest";
import {
  isShopifyFulfilled,
  packOrderLines,
  resolveShopifyFulfillment,
  unpackOrderLines,
} from "./order-cache";

describe("shopify order cache", () => {
  it("keeps fulfillment separate from line items", () => {
    const packed = packOrderLines([{ sku: "A", quantity: 2 }], true);
    expect(unpackOrderLines(packed)).toEqual({
      fulfilled: true,
      lines: [{ sku: "A", quantity: 2 }],
    });
  });

  it("treats older rows without a marker as unknown", () => {
    expect(unpackOrderLines([{ sku: "A", quantity: 1 }])).toEqual({
      fulfilled: null,
      lines: [{ sku: "A", quantity: 1 }],
    });
  });

  it("counts only fully fulfilled Shopify orders as shipped", () => {
    expect(isShopifyFulfilled("fulfilled")).toBe(true);
    expect(isShopifyFulfilled("FULFILLED")).toBe(true);
    expect(isShopifyFulfilled("partial")).toBe(false);
    expect(isShopifyFulfilled("UNFULFILLED")).toBe(false);
    expect(isShopifyFulfilled(null)).toBe(false);
  });

  it("keeps a known fulfillment when the REST status is blank", () => {
    expect(resolveShopifyFulfillment(null, true)).toBe(true);
    expect(resolveShopifyFulfillment("", true)).toBe(true);
    expect(resolveShopifyFulfillment(null, false)).toBe(false);
    expect(resolveShopifyFulfillment("partial", true)).toBe(false);
    expect(resolveShopifyFulfillment("FULFILLED", false)).toBe(true);
  });
});
