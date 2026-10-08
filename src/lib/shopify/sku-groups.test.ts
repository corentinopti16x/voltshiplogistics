import { describe, expect, it } from "vitest";
import { groupListings, pickKeeper, resolveEffectiveSkus, type SkuVariant } from "./sku-groups";

function v(key: string, productId: string, title: string, rawSku: string | null, extra: Partial<SkuVariant> = {}): SkuVariant {
  return { key, shopId: "s1", shopifyProductId: productId, variantId: `9${key}`, title, rawSku, ...extra };
}

describe("resolveEffectiveSkus", () => {
  it("keeps a SKU shared by duplicate listings of the same item", () => {
    const skus = resolveEffectiveSkus([
      v("a", "100", "AI Translator", "smart-voice"),
      v("b", "200", "ECDF AI Translator", "smart-voice"),
      v("c", "300", "AI Translator", "smart-voice"),
    ]);
    expect([...skus.values()]).toEqual(["smart-voice", "smart-voice", "smart-voice"]);
  });

  it("gives its own SKU to a different item typed with the same SKU (oldest listing keeps it)", () => {
    const skus = resolveEffectiveSkus([
      v("vac", "100", "4-in-1 Portable Cordless Mini Vacuum", "vac-sku"),
      v("case1", "200", "Translator Carrying Case", "vac-sku"),
      v("case2", "300", "Translator Carrying Case", "vac-sku"),
    ]);
    expect(skus.get("vac")).toBe("vac-sku");
    expect(skus.get("case1")).toBe("SHOPIFY-P200");
    expect(skus.get("case2")).toBe("SHOPIFY-P200");
  });

  it("never splits a SKU across stores (translated titles)", () => {
    const skus = resolveEffectiveSkus([
      v("fr", "100", "Collier Maman — prénoms gravés", "COL-1"),
      v("us", "200", "Mom Necklace — engraved names", "COL-1", { shopId: "s2" }),
    ]);
    expect([...skus.values()]).toEqual(["COL-1", "COL-1"]);
  });

  it("falls back to the variant id without SKU or when split by the admin", () => {
    const skus = resolveEffectiveSkus([v("a", "1", "Mug", null), v("b", "2", "Mug", "MUG", { split: true })]);
    expect(skus.get("a")).toBe("SHOPIFY-9a");
    expect(skus.get("b")).toBe("SHOPIFY-9b");
  });

  it("ignores words common to the whole catalogue (brand, product line)", () => {
    const filler = Array.from({ length: 10 }, (_, i) => v(`f${i}`, `9${i}`, `Phéromones produit ${i}abc`, `F${i}`));
    const skus = resolveEffectiveSkus([
      ...filler,
      v("x", "100", "Elixir aux phéromones", "FRW1"),
      v("y", "200", "Bracelet aux phéromones", "FRW1"),
    ]);
    expect(skus.get("x")).toBe("FRW1");
    expect(skus.get("y")).toBe("SHOPIFY-P200");
  });
});

describe("groupListings", () => {
  it("joins listings of one store through any shared SKU, never across stores", () => {
    const groups = groupListings([
      { shopId: "s1", shopifyProductId: "1", sku: "A" },
      { shopId: "s1", shopifyProductId: "1", sku: "B" },
      { shopId: "s1", shopifyProductId: "5", sku: "b" },
      { shopId: "s2", shopifyProductId: "7", sku: "b" },
      { shopId: "s1", shopifyProductId: "3", sku: "C" },
    ]);
    expect(groups.map((g) => g.sort())).toEqual([["s1:1", "s1:5"], ["s2:7"], ["s1:3"]]);
  });
});

describe("groupListings without SKU", () => {
  it("joins pages without SKU of one store that have the same title", () => {
    const groups = groupListings([
      { shopId: "s1", shopifyProductId: "1", sku: "SHOPIFY-11", title: "Magnesium Complex" },
      { shopId: "s1", shopifyProductId: "2", sku: "SHOPIFY-22", title: "Magnesium complex." },
      { shopId: "s1", shopifyProductId: "3", sku: "SHOPIFY-33", title: "Magnésium Complex" },
      { shopId: "s2", shopifyProductId: "4", sku: "SHOPIFY-44", title: "Magnesium Complex" },
      { shopId: "s1", shopifyProductId: "5", sku: "SHOPIFY-55", title: "Collagène" },
    ]);
    expect(groups.map((g) => g.sort())).toEqual([["s1:1", "s1:2", "s1:3"], ["s2:4"], ["s1:5"]]);
  });
});

describe("pickKeeper", () => {
  it("prefers a hand-made product, then the most complete, then the oldest", () => {
    const keeper = pickKeeper([
      { id: "a", auto: true, hasData: true, createdAt: "2026-01-01" },
      { id: "b", auto: false, hasData: false, createdAt: "2026-02-01" },
      { id: "c", auto: true, hasData: false, createdAt: "2025-01-01" },
    ]);
    expect(keeper?.id).toBe("b");
    expect(
      pickKeeper([
        { id: "a", auto: true, hasData: false, createdAt: "2026-01-01" },
        { id: "c", auto: true, hasData: false, createdAt: "2025-01-01" },
      ])?.id,
    ).toBe("c");
  });
});
