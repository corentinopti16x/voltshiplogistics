import { describe, expect, it } from "vitest";
import { buildTodo, missingFields, nextVoltshipSku, rankLinkCandidates, titleSimilarity } from "./todo-core";

const variant = (over: Partial<Parameters<typeof buildTodo>[0][number]> = {}) => ({
  id: "v1",
  client_id: "c1",
  shop_id: "s1",
  shopify_product_id: "p1",
  title: "Brassière sport",
  sku: "BRA-1",
  photo_url: null,
  units_90d: 0,
  imported_product_id: null,
  ...over,
});
const product = (over: Partial<Parameters<typeof buildTodo>[1][number]> = {}) => ({
  id: "vp1",
  client_id: "c1",
  title: "Brassière",
  sku: null,
  weight_g: 120,
  client_price: 4.2,
  shipping_channel: "standard",
  factory_purchase_price: 18,
  mapped_skus: [],
  ...over,
});

describe("todo", () => {
  it("lists missing fields", () => {
    expect(missingFields(null)).toContain("link");
    expect(missingFields(product({ weight_g: null, factory_purchase_price: 0 }))).toEqual(["weight", "factory_price"]);
    expect(missingFields(product())).toEqual([]);
  });

  it("groups variants, links by SKU and prioritises products that sell", () => {
    const items = buildTodo(
      [
        variant({ id: "a", units_90d: 3 }),
        variant({ id: "b", sku: "BRA-2", units_90d: 2 }),
        variant({ id: "c", shopify_product_id: "p2", title: "Legging", sku: "LEG", units_90d: 0 }),
        variant({ id: "d", shopify_product_id: "p3", title: "Short", sku: "SH", units_90d: 9 }),
      ],
      [product({ mapped_skus: ["BRA-1"], client_price: null }), product({ id: "vp2", sku: "SH" })],
    );
    expect(items.map((item) => [item.shopifyProductId, item.priority, item.units90d, item.missing])).toEqual([
      ["p1", "required", 5, ["client_price"]],
      ["p2", "optional", 0, ["link", "weight", "client_price", "channel", "factory_price"]],
    ]);
    expect(items[0].productId).toBe("vp1");
    expect(items[0].skus).toEqual(["BRA-1", "BRA-2"]);
  });

  it("does not link a SKU of another client", () => {
    const items = buildTodo([variant()], [product({ client_id: "other", sku: "BRA-1" })]);
    expect(items[0].productId).toBeNull();
  });

  it("ranks link candidates by title", () => {
    expect(titleSimilarity("Brassière sport noire", "brassiere sport")).toBeGreaterThan(0.5);
    const ranked = rankLinkCandidates("Legging gainant", [
      { id: "1", title: "Brassière" },
      { id: "2", title: "Legging gainant taille haute" },
    ]);
    expect(ranked[0].id).toBe("2");
  });

  it("generates the next Voltship SKU", () => {
    expect(nextVoltshipSku("liora", [])).toBe("VS-LIORA-001");
    expect(nextVoltshipSku("Petit Nuage", ["VS-PETITNUAGE-009", "X", null])).toBe("VS-PETITNUAGE-010");
  });
});
