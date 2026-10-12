import { describe, expect, it } from "vitest";
import { clientSkuCode, proposeSkus, skuError, slugWords } from "./sku-fix-core";

describe("slugWords", () => {
  it("keeps significant words, strips accents and symbols, respects the length", () => {
    expect(slugWords("Liora® - Ensemble de bracelets personnalisés", 3, 20)).toBe("LIORA-ENSEMBLE");
    expect(slugWords("Collagène", 3, 20)).toBe("COLLAGENE");
    expect(slugWords("Premium Organic Hibiscus Flowers", 3, 20)).toBe("PREMIUM-ORGANIC");
    expect(slugWords("Or / 3", 3, 14)).toBe("OR-3");
    expect(slugWords("Supercalifragilisticexpialidocious", 3, 10)).toBe("SUPERCALIF");
  });
});

describe("clientSkuCode", () => {
  it("uses the client code, else the name", () => {
    expect(clientSkuCode("ECDF", "Maxime")).toBe("ECDF");
    expect(clientSkuCode(null, "Maxime")).toBe("MAX");
    expect(clientSkuCode("", "Petit Nuage (démo)")).toBe("PET");
  });
});

describe("skuError", () => {
  it("rejects empty, reserved and odd SKUs", () => {
    expect(skuError("MAX-COLLAGENE")).toBeNull();
    expect(skuError("FRW3001/1+1")).toBeNull();
    expect(skuError("  ")).toBe("empty");
    expect(skuError("SHOPIFY-123")).toBe("reserved");
    expect(skuError("a b")).toBe("format");
  });
});

describe("proposeSkus", () => {
  it("gives duplicated pages of the same item the same SKU and avoids taken ones", () => {
    const proposals = proposeSkus(
      [
        { key: "1", clientCode: "MAX", groupKey: "p1", productTitle: "Magnesium Complex", variantTitle: "Default Title" },
        { key: "2", clientCode: "MAX", groupKey: "p1", productTitle: "Magnesium Complex", variantTitle: null },
        { key: "3", clientCode: "MAX", groupKey: "p2", productTitle: "Magnesium Complex", variantTitle: null },
        { key: "4", clientCode: "BRG", groupKey: "p3", productTitle: "Liora® Set", variantTitle: "Or" },
        { key: "5", clientCode: "BRG", groupKey: "p3", productTitle: "Liora® Set", variantTitle: "Argent" },
      ],
      ["max-magnesium-complex"],
    );
    expect(proposals.get("1")).toBe("MAX-MAGNESIUM-COMPLEX-2");
    expect(proposals.get("2")).toBe("MAX-MAGNESIUM-COMPLEX-2");
    expect(proposals.get("3")).toBe("MAX-MAGNESIUM-COMPLEX-3");
    expect(proposals.get("4")).toBe("BRG-LIORA-SET-OR");
    expect(proposals.get("5")).toBe("BRG-LIORA-SET-ARGENT");
  });
});
