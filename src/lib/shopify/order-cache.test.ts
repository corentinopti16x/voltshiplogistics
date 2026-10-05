import { describe, expect, it } from "vitest";
import {
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
