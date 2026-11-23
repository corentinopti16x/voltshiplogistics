import { describe, expect, it } from "vitest";
import { needsSetCheck, suffixPieces, variantPieces } from "./variant-pieces";

describe("suffixPieces", () => {
  it("reads -1 / -2 / -4 on the same root", () => {
    const map = suffixPieces(["LNG-WSTRAW-1", "LNG-WSTRAW-2", "LNG-WSTRAW-4"]);
    expect(map.get("LNG-WSTRAW-4")).toBe(4);
    expect(map.get("LNG-WSTRAW-1")).toBe(1);
  });
  it("ignores sizes and lone suffixes", () => {
    expect(suffixPieces(["SHOE-36", "SHOE-38", "SHOE-40"]).size).toBe(0);
    expect(suffixPieces(["CAP-4"]).size).toBe(0);
  });
});

describe("variantPieces", () => {
  it("straw: 1, 2 and 4 pieces, product setting ignored", () => {
    const rows = variantPieces(
      [
        { sku: "LNG-WSTRAW-1", variantTitle: "Pack: 1 Straw", packUnits: null },
        { sku: "LNG-WSTRAW-2", variantTitle: "Pack: 2 Straws", packUnits: null },
        { sku: "LNG-WSTRAW-4", variantTitle: "Pack: 4 Straws", packUnits: null },
      ],
      4,
    );
    expect(rows.map((r) => r.pieces)).toEqual([1, 2, 4]);
    expect(needsSetCheck(rows)).toBe(true);
  });
  it("team value wins and clears the alert", () => {
    const rows = variantPieces([
      { sku: "BAG-15", variantTitle: "15 bags", packUnits: 15 },
      { sku: "BAG-30", variantTitle: "30 bags", packUnits: null },
    ]);
    expect(rows[0]).toEqual({ sku: "BAG-15", pieces: 15, guessed: false });
    expect(needsSetCheck(rows)).toBe(false);
  });
  it("colour variants keep the product's pieces", () => {
    const rows = variantPieces(
      [
        { sku: "BRA-BLK", variantTitle: "Color: Black", packUnits: null },
        { sku: "BRA-WHT", variantTitle: "Color: White", packUnits: null },
      ],
      2,
    );
    expect(rows.map((r) => r.pieces)).toEqual([2, 2]);
    expect(needsSetCheck(rows)).toBe(false);
  });
});
