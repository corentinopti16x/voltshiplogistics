import { describe, expect, it } from "vitest";
import { isServiceLine, neutralCode, proposeSkus, skuError, slugWords } from "./sku-fix-core";

describe("slugWords", () => {
  it("keeps significant words, strips accents and symbols, respects the length", () => {
    expect(slugWords("Liora® - Ensemble de bracelets personnalisés", 3, 20)).toBe("LIORA-ENSEMBLE");
    expect(slugWords("Collagène", 3, 20)).toBe("COLLAGENE");
    expect(slugWords("Premium Organic Hibiscus Flowers", 3, 20)).toBe("PREMIUM-ORGANIC");
    expect(slugWords("Or / 3", 3, 14)).toBe("OR-3");
    expect(slugWords("Supercalifragilisticexpialidocious", 3, 10)).toBe("SUPERCALIF");
  });
});

describe("neutralCode", () => {
  it("is stable, 5 characters, without ambiguous letters", () => {
    const code = neutralCode("product-1");
    expect(code).toBe(neutralCode("product-1"));
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{5}$/);
    expect(neutralCode("product-1", 1)).not.toBe(code);
    expect(neutralCode("product-2")).not.toBe(code);
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
  it("is neutral: country + opaque code + option, same code for duplicated pages", () => {
    const proposals = proposeSkus(
      [
        { key: "1", country: "FR", groupKey: "p1", variantTitle: "Default Title" },
        { key: "2", country: "FR", groupKey: "p1", variantTitle: null },
        { key: "3", country: "FR", groupKey: "p2", variantTitle: null },
        { key: "4", country: "us", groupKey: "p3", variantTitle: "Gold" },
        { key: "5", country: "us", groupKey: "p3", variantTitle: "Argent + Or" },
        { key: "6", country: "", groupKey: "p4", variantTitle: null },
      ],
      [],
    );
    const code1 = neutralCode("p1");
    const code3 = neutralCode("p3");
    expect(proposals.get("1")).toBe(`FR-${code1}`);
    expect(proposals.get("2")).toBe(`FR-${code1}`);
    expect(proposals.get("3")).toMatch(/^FR-[2-9A-HJKMNP-Z]{5}$/);
    expect(proposals.get("3")).not.toBe(`FR-${code1}`);
    expect(proposals.get("4")).toBe(`US-${code3}-GOLD`);
    expect(proposals.get("5")).toBe(`US-${code3}-ARGENT-OR`);
    expect(proposals.get("6")).toMatch(/^[2-9A-HJKMNP-Z]{5}$/);
    for (const sku of proposals.values()) expect(sku).not.toMatch(/MAGNESIUM|ECDF|MELVYN/);
  });

  it("never reuses a taken code", () => {
    const taken = [`FR-${neutralCode("p1")}`];
    const proposals = proposeSkus([{ key: "1", country: "FR", groupKey: "p1", variantTitle: null }], taken);
    expect(proposals.get("1")).toBe(`FR-${neutralCode("p1", 1)}`);
  });
});
