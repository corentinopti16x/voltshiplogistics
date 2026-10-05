import { describe, expect, it } from "vitest";
import { parseOrderLookup, publicFulfillmentStatus, shapePublicOrder, trackingUrlFor, type CachedOrder } from "./orders";

const order: CachedOrder = {
  id: "0f2c6a9e-1b2d-4c3e-9f8a-123456789abc",
  shopify_order_id: "5678901234567",
  order_number: "1234",
  placed_at: "2026-09-28T09:15:00.000Z",
  order_date: "2026-09-28",
  cancelled: false,
  line_items_json: [{ _order: { fulfilled: false } }, { sku: "LAMP-01", quantity: 2, title: "Lampe nuage" }, { sku: "CABLE-X", quantity: 1 }],
  customer_key: "abc",
  customer_email_key: "def",
  shop_domain: "monstore.myshopify.com",
};

describe("publicFulfillmentStatus", () => {
  it("maps ECCANG codes to the public statuses", () => {
    const base = { cancelled: false, shopifyFulfilled: false };
    expect(publicFulfillmentStatus({ ...base, eccangStatus: "pending" })).toBe("received");
    expect(publicFulfillmentStatus({ ...base, eccangStatus: "C" })).toBe("received");
    expect(publicFulfillmentStatus({ ...base, eccangStatus: "W" })).toBe("preparing");
    expect(publicFulfillmentStatus({ ...base, eccangStatus: "H" })).toBe("preparing");
    expect(publicFulfillmentStatus({ ...base, eccangStatus: "D" })).toBe("shipped");
    expect(publicFulfillmentStatus({ ...base, eccangStatus: "X" })).toBe("cancelled");
    expect(publicFulfillmentStatus({ ...base, eccangStatus: "N" })).toBe("unknown");
    expect(publicFulfillmentStatus({ ...base, eccangStatus: "P" })).toBe("unknown");
  });
  it("falls back to Shopify fulfilment and cancellation without a warehouse row", () => {
    expect(publicFulfillmentStatus({ cancelled: false, shopifyFulfilled: null, eccangStatus: null })).toBe("received");
    expect(publicFulfillmentStatus({ cancelled: false, shopifyFulfilled: true, eccangStatus: null })).toBe("shipped");
    expect(publicFulfillmentStatus({ cancelled: true, shopifyFulfilled: true, eccangStatus: "D" })).toBe("cancelled");
  });
});

describe("trackingUrlFor", () => {
  it("builds carrier pages and falls back to 17track", () => {
    expect(trackingUrlFor("YunExpress", "YT2026")).toContain("yuntrack.com");
    expect(trackingUrlFor("Colissimo", "6A123")).toContain("laposte.fr");
    expect(trackingUrlFor("Some Carrier", "ABC 1")).toBe("https://t.17track.net/en#nums=ABC%201");
    expect(trackingUrlFor("DHL", null)).toBeNull();
  });
});

describe("shapePublicOrder", () => {
  it("shapes a shipped order with warehouse data", () => {
    const body = shapePublicOrder(
      order,
      {
        reference_no: "VS-ACME-1234",
        status: "D",
        tracking_no: "YT2026000111",
        carrier_code: "YunExpress",
        shipping_method: "YE_CHC",
        shipped_at: "2026-09-30T02:00:00.000Z",
        billed_weight_g: 420,
        updated_at: "2026-09-30T02:05:00.000Z",
      },
      { "CABLE-X": "Câble USB-C" },
    );
    expect(body).toEqual({
      order: { number: "1234", placed_at: "2026-09-28T09:15:00.000Z", shop: "monstore.myshopify.com" },
      fulfillment: {
        status: "shipped",
        shipped_at: "2026-09-30T02:00:00.000Z",
        carrier: "YunExpress",
        service: "YE_CHC",
        tracking_number: "YT2026000111",
        tracking_url: "https://www.yuntrack.com/parcelTracking?id=YT2026000111",
        billed_weight_g: 420,
        last_event_at: "2026-09-30T02:05:00.000Z",
      },
      items: [
        { sku: "LAMP-01", title: "Lampe nuage", qty: 2 },
        { sku: "CABLE-X", title: "Câble USB-C", qty: 1 },
      ],
      warehouse: { reference: "VS-ACME-1234" },
    });
    // No PII leaks.
    expect(JSON.stringify(body)).not.toMatch(/abc|def|customer/);
  });
  it("shapes a received order without warehouse data", () => {
    const body = shapePublicOrder({ ...order, placed_at: null }, null);
    expect(body.fulfillment.status).toBe("received");
    expect(body.fulfillment.tracking_number).toBeNull();
    expect(body.fulfillment.tracking_url).toBeNull();
    expect(body.order.placed_at).toBe("2026-09-28T00:00:00.000Z");
    expect(body.warehouse.reference).toBeNull();
    expect(body.items[1].title).toBeNull();
  });
});

describe("parseOrderLookup", () => {
  it("recognises numbers, references, Shopify ids and uuids", () => {
    expect(parseOrderLookup("#1234")).toEqual({ kind: "number", value: "1234" });
    expect(parseOrderLookup("%231234")).toEqual({ kind: "number", value: "1234" });
    expect(parseOrderLookup("vs-acme-1234")).toEqual({ kind: "reference", value: "VS-ACME-1234" });
    expect(parseOrderLookup("5678901234567")).toEqual({ kind: "shopify_id", value: "5678901234567" });
    expect(parseOrderLookup(order.id)).toEqual({ kind: "uuid", value: order.id });
    expect(parseOrderLookup("hello")).toBeNull();
    expect(parseOrderLookup("")).toBeNull();
  });
});
