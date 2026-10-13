import { describe, expect, it } from "vitest";
import { isServiceLine, productWords, proposeSkus, skuError, slugWords } from "./sku-fix-core";

describe("slugWords", () => {
  it("keeps significant words, strips accents and symbols, respects the length", () => {
    expect(slugWords("Liora® - Ensemble de bracelets personnalisés", 3, 20)).toBe("LIORA-ENSEMBLE");
    expect(slugWords("Collagène", 3, 20)).toBe("COLLAGENE");
    expect(slugWords("Premium Organic Hibiscus Flowers", 3, 20)).toBe("PREMIUM-ORGANIC");
    expect(slugWords("Or / 3", 3, 14)).toBe("OR-3");
    expect(slugWords("Supercalifragilisticexpialidocious", 3, 10)).toBe("SUPERCALIF");
  });
});

describe("productWords", () => {
  it("keeps the words that say what the item is", () => {
    expect(productWords("Premium Organic Hibiscus Flowers")).toEqual(["HIBISCUS", "FLOWERS"]);
    expect(productWords("Liora® - Ensemble de bracelets personnalisés")).toEqual(["LIORA", "BRACELETS"]);
    expect(productWords("Muscle Peptide Dileucine 185 - 84 Capsules")).toEqual(["MUSCLE", "PEPTIDE", "DILEUCINE", "CAPSULES"]);
    expect(productWords("Premium Set")).toEqual(["PREMIUM", "SET"]);
  });
});

describe("isServiceLine", () => {
  it("spots shipping insurance and free shipping lines", () => {
    expect(isServiceLine("Assurance Transport")).toBe(true);
    expect(isServiceLine("Livraison Gratuite")).toBe(true);
    expect(isServiceLine("Shipping Protection")).toBe(true);
    expect(isServiceLine("Magnesium Complex")).toBe(false);
    expect(isServiceLine("Translator Carrying Case")).toBe(false);
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
  it("is readable: country + product + option number, same SKU for duplicated pages", () => {
    const proposals = proposeSkus(
      [
        { key: "1", country: "FR", groupKey: "p1", productTitle: "Magnesium Complex", variantTitle: "Default Title" },
        { key: "2", country: "FR", groupKey: "p1", productTitle: "Magnesium Complex.", variantTitle: null },
        { key: "3", country: "FR", groupKey: "p2", productTitle: "Magnesium Complex Forte", variantTitle: null },
        { key: "4", country: "fr", groupKey: "p3", productTitle: "Liora® - Ensemble de bracelets personnalisés", variantTitle: "or" },
        { key: "5", country: "fr", groupKey: "p3", productTitle: "Liora® - Ensemble de bracelets personnalisés", variantTitle: "argent" },
        { key: "6", country: "US", groupKey: "p4", productTitle: "Translator Carrying Case", variantTitle: null },
        { key: "7", country: "", groupKey: "p5", productTitle: "Collagène", variantTitle: null },
      ],
      [],
    );
    expect(proposals.get("1")).toBe("FR-MAGNESIUM-COMPLEX-01");
    expect(proposals.get("2")).toBe("FR-MAGNESIUM-COMPLEX-01");
    expect(proposals.get("3")).toBe("FR-MAGNESIUM-COMPLEX-FORTE-01");
    expect(proposals.get("5")).toBe("FR-LIORA-BRACELETS-01");
    expect(proposals.get("4")).toBe("FR-LIORA-BRACELETS-02");
    expect(proposals.get("6")).toBe("US-TRANSLATOR-CARRYING-01");
    expect(proposals.get("7")).toBe("COLLAGENE-01");
  });

  it("never takes a name used by another item, and reuses the item's own SKU", () => {
    const other = proposeSkus(
      [{ key: "1", country: "FR", groupKey: "p1", productTitle: "Collagène", variantTitle: null }],
      [{ sku: "FR-COLLAGENE-01", owner: "p9" }],
    );
    expect(other.get("1")).toBe("FR-COLLAGENE2-01");
    const own = proposeSkus(
      [{ key: "1", country: "FR", groupKey: "p1", productTitle: "Collagène", variantTitle: null }],
      [{ sku: "FR-COLLAGENE-01", owner: "p1" }],
    );
    expect(own.get("1")).toBe("FR-COLLAGENE-01");
    const longer = proposeSkus(
      [{ key: "1", country: "FR", groupKey: "p1", productTitle: "Magnesium Complex", variantTitle: null }],
      [{ sku: "FR-MAGNESIUM-COMPLEX-FORTE-01", owner: "p2" }],
    );
    expect(longer.get("1")).toBe("FR-MAGNESIUM-COMPLEX-01");
  });
});
