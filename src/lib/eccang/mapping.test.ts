import { describe, expect, it } from "vitest";
import type { ProductRow } from "@/lib/products/types";
import {
  asnReferenceNo,
  billedWeightG,
  isProductExistsError,
  mapAsnStatus,
  mapAsnToInbound,
  mapInventoryToStock,
  mapOrderStatusToRow,
  mapProductToEccang,
  mapShopifyOrderToEccang,
  orderLinesForEccang,
  orderLinesWithoutSku,
  orderReferenceNo,
  parseCallback,
  parseShippingMethodMap,
  resolveShippingMethod,
  type ShopifyOrderForEccang,
} from "./mapping";

const shopifyOrder: ShopifyOrderForEccang = {
  id: 5551234,
  order_number: 1042,
  name: "#1042",
  email: "jane@example.com",
  currency: "EUR",
  total_price: "59.90",
  shipping_address: {
    first_name: "Jane",
    last_name: "Doe",
    company: "",
    address1: "12 rue de la Paix",
    address2: "Bât. B",
    city: "Paris",
    province: "Île-de-France",
    province_code: null,
    zip: "75002",
    country_code: "fr",
    phone: "+33 6 12 34 56 78",
  },
  line_items: [
    { sku: "VS-LAMP-01", quantity: 2, title: "Lampe lune", price: "24.95" },
    { sku: "VS-LAMP-01", quantity: 1, title: "Lampe lune", price: "24.95" },
    { sku: "VS-GIFT", quantity: 1, title: "Carte cadeau", requires_shipping: false },
    { sku: "", quantity: 1, title: "Emballage cadeau" },
  ],
};

describe("reference numbers", () => {
  it("formats VS-<CODE>-<order number>", () => {
    expect(orderReferenceNo("ecdf", 1042)).toBe("VS-ECDF-1042");
    expect(orderReferenceNo("ma boutique_x", "#88")).toBe("VS-MA-BOUTIQUE-X-88");
    expect(orderReferenceNo(null, 7)).toBe("VS-CLIENT-7");
  });
  it("formats ASN references with the day and a nonce", () => {
    expect(asnReferenceNo("ecdf", new Date("2026-10-08T09:00:00Z"), "ab12cd")).toBe(
      "VSIN-ECDF-20261008-AB12CD",
    );
  });
});

describe("shipping method map", () => {
  const map = parseShippingMethodMap(
    JSON.stringify({ "YunExpress|CHC": "YE_CHC", YunExpress: "YE_STD", "default:FR": "FR_DEF", default: "ANY", bad: 3 }),
  );
  it("parses JSON strings and drops non-string values", () => {
    expect(map).toEqual({ "YunExpress|CHC": "YE_CHC", YunExpress: "YE_STD", "default:FR": "FR_DEF", default: "ANY" });
    expect(parseShippingMethodMap("not json")).toEqual({});
  });
  it("prefers carrier|line, falls back to carrier, case-insensitive", () => {
    expect(resolveShippingMethod(map, "YunExpress", "CHC")).toBe("YE_CHC");
    expect(resolveShippingMethod(map, "yunexpress", "Other line")).toBe("YE_STD");
    expect(resolveShippingMethod(map, "4PX", null)).toBeNull();
    expect(resolveShippingMethod(map, null)).toBeNull();
  });
});

describe("order lines", () => {
  it("merges same-SKU lines and skips non-shippable / SKU-less lines", () => {
    expect(orderLinesForEccang(shopifyOrder)).toEqual([
      { product_sku: "VS-LAMP-01", quantity: 3, product_name_en: "Lampe lune", product_declared_value: 24.95 },
    ]);
    expect(orderLinesWithoutSku(shopifyOrder)).toEqual(["Emballage cadeau"]);
  });
});

describe("mapShopifyOrderToEccang", () => {
  it("maps consignee, items, shop and sale amount into createOrder params", () => {
    const payload = mapShopifyOrderToEccang(shopifyOrder, {
      referenceNo: "VS-ECDF-1042",
      warehouseCode: "SZ01",
      shippingMethod: "YE_CHC",
      shopDomain: "ecdf.myshopify.com",
    });
    expect(payload).toEqual({
      reference_no: "VS-ECDF-1042",
      platform: "OTHER",
      shipping_method: "YE_CHC",
      warehouse_code: "SZ01",
      country_code: "FR",
      province: "Île-de-France",
      city: "Paris",
      address1: "12 rue de la Paix",
      address2: "Bât. B",
      zipcode: "75002",
      name: "Jane Doe",
      phone: "+33 6 12 34 56 78",
      email: "jane@example.com",
      platform_shop: "ecdf.myshopify.com",
      order_sale_amount: 59.9,
      order_sale_currency: "EUR",
      order_desc: "Shopify #1042",
      verify: 1,
      items: [
        { product_sku: "VS-LAMP-01", quantity: 3, product_name_en: "Lampe lune", product_declared_value: 24.95 },
      ],
    });
  });

  it("rejects orders without an address or ISO country", () => {
    expect(() =>
      mapShopifyOrderToEccang({ ...shopifyOrder, shipping_address: null }, {
        referenceNo: "x",
        warehouseCode: "w",
        shippingMethod: "m",
      }),
    ).toThrow(/shipping address/);
    expect(() =>
      mapShopifyOrderToEccang(
        { ...shopifyOrder, shipping_address: { ...shopifyOrder.shipping_address, country_code: "France" } },
        { referenceNo: "x", warehouseCode: "w", shippingMethod: "m" },
      ),
    ).toThrow(/country/);
  });
});

describe("mapInventoryToStock", () => {
  it("maps sellable/reserved/onway+pending and sums batches per SKU", () => {
    const now = new Date("2026-10-08T10:00:00Z");
    const rows = mapInventoryToStock(
      "client-1",
      [
        { product_sku: "A", warehouse_code: "SZ01", sellable: "10", reserved: "2", onway: "5", pending: "1" },
        { product_sku: "A", warehouse_code: "SZ01", sellable: 4, reserved: 0, onway: 0, pending: 0 },
        { product_sku: "B", warehouse_code: "OTHER", sellable: 99 },
        { product_sku: "", sellable: 1 },
      ],
      { warehouseCode: "SZ01", now },
    );
    expect(rows).toEqual([
      {
        client_id: "client-1",
        sku: "A",
        qty_available: 14,
        qty_reserved: 2,
        inbound_qty: 6,
        last_synced_at: now.toISOString(),
      },
    ]);
  });
});

describe("order status", () => {
  it("converts order_weight kg to billed grams", () => {
    expect(billedWeightG("0.482")).toBe(482);
    expect(billedWeightG(1.2)).toBe(1200);
    expect(billedWeightG("")).toBeNull();
  });
  it("maps a shipped getOrderByRefCode record", () => {
    const now = new Date("2026-10-10T08:00:00Z");
    const row = mapOrderStatusToRow(
      {
        order_code: "OC001",
        reference_no: "VS-ECDF-1042",
        order_status: "D",
        tracking_no: "YT2026FR0001",
        carrier_name: "YunExpress",
        shipping_method: "YE_CHC",
        order_weight: "0.482",
        date_shipping: "2026-10-09 18:30:00",
        fee_details: { totalFee: "4.10", SHIPPING: "3.90", OPF: "0.20" },
      },
      now,
    );
    expect(row.status).toBe("D");
    expect(row.tracking_no).toBe("YT2026FR0001");
    expect(row.carrier_code).toBe("YunExpress");
    expect(row.billed_weight_g).toBe(482);
    expect(row.shipped_at).toBe("2026-10-09T18:30:00.000Z");
    expect(row.fee_json).toEqual({ details: { totalFee: "4.10", SHIPPING: "3.90", OPF: "0.20" }, items: null });
    expect(row.error).toBeNull();
  });
  it("keeps abnormal reason as error and handles object-shaped status", () => {
    const row = mapOrderStatusToRow({ order_status: { code: "N" }, abnormal_reason: "缺货" });
    expect(row.status).toBe("N");
    expect(row.error).toBe("缺货");
    expect(row.shipped_at).toBeNull();
  });
});

describe("ASN mapping", () => {
  it("maps receiving_status codes onto the 4-step rail", () => {
    expect(mapAsnStatus("C")).toEqual({ status: "announced", cancelled: false });
    expect(mapAsnStatus("G")).toEqual({ status: "arrived", cancelled: false });
    expect(mapAsnStatus("F")).toEqual({ status: "qc_in_progress", cancelled: false });
    expect(mapAsnStatus("E")).toEqual({ status: "stocked", cancelled: false });
    expect(mapAsnStatus("X")).toEqual({ status: "announced", cancelled: true });
  });
  it("maps a getAsnList record to an inbound_cache row", () => {
    const row = mapAsnToInbound(
      "client-1",
      {
        receiving_code: "RV0001",
        reference_no: "VSIN-ECDF-20261008-AB12CD",
        receiving_status: "E",
        tracking_number: "SF123",
        eta_date: "2026-10-12",
        warehouse_receiving_complete_time: "2026-10-13 09:00:00",
        warehouse_shelf_time: "2026-10-13 15:00:00",
        items: [{ product_sku: "A", quantity: "100", received_quantity: "98", putaway_qty: "98" }],
      },
      new Date("2026-10-13T16:00:00Z"),
    );
    expect(row.status).toBe("stocked");
    expect(row.eccang_asn_code).toBe("RV0001");
    expect(row.qty_announced).toBe(100);
    expect(row.qty_received).toBe(98);
    expect(row.eta).toBe("2026-10-12");
    expect(row.received_at).toBe("2026-10-13T09:00:00.000Z");
    expect(row.putaway_at).toBe("2026-10-13T15:00:00.000Z");
    expect(row.items_json).toEqual([{ sku: "A", qty: 100, received: 98, putaway: 98 }]);
  });
});

describe("product mapping", () => {
  const product: ProductRow = {
    id: "p1",
    client_id: "c1",
    airtable_record_id: "rec1",
    sku: "VS-LAMP-01",
    title: "Lampe lune",
    photo_url: null,
    created_date: null,
    lifecycle_status: "testing",
    sourcing_status: "validated",
    quote_json: { declared_name_zh: "月球灯", hs_code: "940520" },
    accepted_quote_snapshot_json: null,
    selling_price: 39.9,
    weight_g: 482,
    shipping_channel: "electronics_battery",
    production_lead_days: null,
    moq: null,
    client_price: 8.5,
    stock_manual: null,
    migration_state: null,
    last_synced_at: null,
    created_at: "2026-10-01T00:00:00Z",
  };
  it("maps to createProduct params (kg, cm, USD, verify=1)", () => {
    expect(mapProductToEccang(product)).toEqual({
      product_sku: "VS-LAMP-01",
      reference_no: "p1",
      product_title: "Lampe lune",
      product_title_en: "Lampe lune",
      product_weight: 0.482,
      product_length: 10,
      product_width: 10,
      product_height: 5,
      product_declared_value: 8.5,
      product_declared_name: "Lampe lune",
      product_declared_name_zh: "月球灯",
      hs_code: "940520",
      contain_battery: 1,
      cat_lang: "en",
      verify: 1,
    });
  });
  it("requires a SKU", () => {
    expect(() => mapProductToEccang({ ...product, sku: null })).toThrow(/SKU/);
  });
  it("detects 'already exists' errors", () => {
    expect(isProductExistsError("E200", "SKU已存在")).toBe(true);
    expect(isProductExistsError(null, "product sku exists")).toBe(true);
    expect(isProductExistsError("E1", "weight required")).toBe(false);
  });
});

describe("parseCallback", () => {
  it("reads subscription callbacks (order / receiving / stock)", () => {
    const cb = parseCallback({
      app_key: "k1",
      msg_id: "m1",
      subscript_type: "order",
      body: { order_code: "OC1", reference_no: "VS-ECDF-1", order_status: "D", type: "3" },
    });
    expect(cb).toMatchObject({ appKey: "k1", msgId: "m1", type: "order" });
    expect(cb.body.reference_no).toBe("VS-ECDF-1");
    expect(parseCallback({ app_key: "k", body: { receiving_code: "RV1" } }).type).toBe("receiving");
    expect(parseCallback({ app_key: "k", body: { product_sku: "A" } }).type).toBe("stock");
    expect(parseCallback({ body: JSON.stringify({ receiving_code: "RV1" }) }).type).toBe("receiving");
  });
});

describe("toWarehouseItems sets", () => {
  it("ships pack_pieces pieces per unit sold and merges warehouse SKUs", async () => {
    const { toWarehouseItems } = await import("./mapping");
    const items = toWarehouseItems(
      [
        { product_sku: "LIORA-SET", quantity: 2 },
        { product_sku: "SOLO", quantity: 1 },
      ] as Parameters<typeof toWarehouseItems>[0],
      new Map([["LIORA-SET", "WH-BRACELET"]]),
      new Map([["LIORA-SET", 2]]),
    );
    expect(items).toEqual([
      expect.objectContaining({ product_sku: "WH-BRACELET", quantity: 4 }),
      expect.objectContaining({ product_sku: "SOLO", quantity: 1 }),
    ]);
  });
});
