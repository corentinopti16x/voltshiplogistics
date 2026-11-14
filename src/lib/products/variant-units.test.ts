import { describe, expect, it } from "vitest";
import { guessVariantUnits, variantLabel, variantUnits } from "./variant-units";

describe("guessVariantUnits", () => {
  it("reads a bare number only under a quantity option", () => {
    expect(guessVariantUnits("Pieces: 24")).toBe(24);
    expect(guessVariantUnits("Pieces: 110")).toBe(110);
    expect(guessVariantUnits("Size: 36")).toBe(1);
    expect(guessVariantUnits("24")).toBe(1);
  });

  it("reads quantities named in the value", () => {
    expect(guessVariantUnits("Bundle: 4-Pack")).toBe(4);
    expect(guessVariantUnits("Style: Set of 2")).toBe(2);
    expect(guessVariantUnits("Color: Blue / Offer: Buy 2 Get 1 Free")).toBe(3);
    expect(guessVariantUnits("Offer: x3")).toBe(3);
    expect(guessVariantUnits("6 pcs")).toBe(6);
  });

  it("does not take a clothing size for a quantity", () => {
    expect(guessVariantUnits("Size: 2XL")).toBe(1);
    expect(guessVariantUnits("Size: M / Color: Black")).toBe(1);
    expect(guessVariantUnits(null)).toBe(1);
  });
});

describe("variantUnits", () => {
  it("prefers the value set by the team", () => {
    expect(variantUnits({ pack_units: 10, variant_title: "Pieces: 24" })).toEqual({ units: 10, guessed: false });
    expect(variantUnits({ pack_units: null, variant_title: "Pieces: 24" })).toEqual({ units: 24, guessed: true });
  });
});

describe("variantLabel", () => {
  it("joins option names and values, and skips the default variant", () => {
    expect(variantLabel(["Pieces"], ["24"])).toBe("Pieces: 24");
    expect(variantLabel(["Size", "Color"], ["M", "Black"])).toBe("Size: M / Color: Black");
    expect(variantLabel(["Title"], ["Default Title"], "Default Title")).toBeNull();
  });
});
