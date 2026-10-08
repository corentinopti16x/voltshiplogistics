import { describe, expect, it } from "vitest";
import {
  cacheOrderLines,
  isSuspiciousOrder,
  customerKeyForOrder,
  isShopifyFulfilled,
  packOrderLines,
  pickProductImages,
  resolveShopifyFulfillment,
  unpackOrderLines,
} from "./order-cache";

describe("shopify order cache", () => {
  it("keeps fulfillment separate from line items", () => {
    const packed = packOrderLines([{ sku: "A", quantity: 2 }], true);
    expect(unpackOrderLines(packed)).toEqual({
      fulfilled: true,
      lines: [{ sku: "A", quantity: 2 }],
      total: null,
      currency: null,
      units: null,
      suspicious: false,
      review: null,
      name: null,
    });
  });

  it("keeps line prices for per-product revenue", () => {
    const lines = cacheOrderLines([{ sku: "A", quantity: 2, price: "29.99" }]);
    expect(unpackOrderLines(packOrderLines(lines, false, { amount: 64.97, units: 3 }))).toMatchObject({
      lines: [{ sku: "A", quantity: 2, price: 29.99 }],
      total: 64.97,
      units: 3,
    });
  });

  it("flags orders that cannot be real sales (≥10 units for < 1 € each)", () => {
    expect(isSuspiciousOrder("2.99", 50)).toBe(true);
    expect(isSuspiciousOrder(1495, 50)).toBe(false);
    expect(isSuspiciousOrder(0, 3)).toBe(false);
    const packed = packOrderLines([{ sku: "A", quantity: 50 }], false, { amount: "2.99", units: 50 });
    expect(unpackOrderLines(packed).suspicious).toBe(true);
  });

  it("keeps the order total and currency for the dashboard revenue", () => {
    const packed = packOrderLines([{ sku: "A", quantity: 1 }], false, {
      amount: "34.98",
      currency: "EUR",
    });
    expect(unpackOrderLines(packed)).toMatchObject({ total: 34.98, currency: "EUR" });
  });

  it("treats older rows without a marker as unknown", () => {
    expect(unpackOrderLines([{ sku: "A", quantity: 1 }])).toEqual({
      fulfilled: null,
      lines: [{ sku: "A", quantity: 1 }],
      total: null,
      currency: null,
      units: null,
      suspicious: false,
      review: null,
      name: null,
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

  it("hashes the customer id, else the lowercased e-mail, and never keeps the raw value", () => {
    const byId = customerKeyForOrder({ customer: { id: 42 }, email: "A@b.co" });
    expect(byId).toMatch(/^[a-f0-9]{64}$/);
    expect(byId).toBe(customerKeyForOrder({ customer: { id: "42" } }));
    const byEmail = customerKeyForOrder({ customer: null, email: " A@B.co " });
    expect(byEmail).toBe(customerKeyForOrder({ email: "a@b.co" }));
    expect(byEmail).not.toBe(byId);
    expect(byEmail).not.toContain("a@b.co");
    expect(customerKeyForOrder({})).toBeNull();
  });

  it("keeps up to four images in page order with the variant image first", () => {
    const product = {
      image: { src: "p1" },
      images: [
        { id: 1, src: "p1", position: 1 },
        { id: 2, src: "p2", position: 2 },
        { id: 3, src: "p3", position: 3 },
        { id: 4, src: "p4", position: 4 },
        { id: 5, src: "p5", position: 5 },
      ],
    };
    expect(pickProductImages(product, null)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(pickProductImages(product, 3)).toEqual(["p3", "p1", "p2", "p4"]);
    expect(pickProductImages({ image: { src: "only" } }, null)).toEqual(["only"]);
    expect(pickProductImages({}, null)).toEqual([]);
  });
});
