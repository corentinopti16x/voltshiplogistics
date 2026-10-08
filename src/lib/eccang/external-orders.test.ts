import { describe, expect, it } from "vitest";
import {
  eccangOrderItems,
  externalOrderKey,
  isVoltshipOrderReference,
  mapExternalOrderToRow,
} from "./mapping";

describe("external ECCANG orders", () => {
  it("recognises our own references", () => {
    expect(isVoltshipOrderReference("VS-PETITNUAGE-1042")).toBe(true);
    expect(isVoltshipOrderReference("vs-abc-1")).toBe(true);
    expect(isVoltshipOrderReference("SHOP-1042")).toBe(false);
    expect(isVoltshipOrderReference(null)).toBe(false);
  });

  it("merges items by SKU", () => {
    expect(
      eccangOrderItems({
        items: [
          { product_sku: "A", quantity: "2" },
          { product_sku: "A", quantity: 1 },
          { product_sku: "B", quantity: "0" },
          { product_sku: "", quantity: 4 },
        ],
      }),
    ).toEqual([
      { sku: "A", quantity: 3 },
      { sku: "B", quantity: 1 },
    ]);
    expect(eccangOrderItems({})).toEqual([]);
  });

  it("maps a getOrderList record to an external row", () => {
    const now = new Date("2026-10-08T00:00:00Z");
    const row = mapExternalOrderToRow(
      "client-1",
      {
        order_code: "WO123",
        reference_no: "MY-ERP-9",
        order_status: "D",
        tracking_no: "YT1",
        carrier_name: "YunExpress",
        order_weight: "0.35",
        date_shipping: "2026-10-07 10:00:00",
        ...({ date_create: "2026-10-06 09:00:00", items: [{ product_sku: "SKU1", quantity: "2" }] } as object),
      },
      now,
    );
    expect(row).toMatchObject({
      client_id: "client-1",
      reference_no: externalOrderKey("WO123"),
      external_ref: "MY-ERP-9",
      source: "external",
      status: "D",
      tracking_no: "YT1",
      billed_weight_g: 350,
      items_json: [{ sku: "SKU1", quantity: 2 }],
      eccang_created_at: "2026-10-06T09:00:00.000Z",
    });
    expect(mapExternalOrderToRow("c", { reference_no: "x" })).toBeNull();
  });
});
