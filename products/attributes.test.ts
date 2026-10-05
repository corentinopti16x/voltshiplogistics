import { describe, expect, it } from "vitest";
import {
  deriveSuggestedChannel,
  estimateBasis,
  parseProductAttributes,
  tickedAttributes,
} from "./attributes";

describe("deriveSuggestedChannel", () => {
  it("defaults to standard when nothing is ticked", () => {
    expect(deriveSuggestedChannel({})).toBe("standard");
  });

  it("maps each single answer to its channel", () => {
    expect(deriveSuggestedChannel({ electronics: true })).toBe("electronics_battery");
    expect(deriveSuggestedChannel({ liquid: true })).toBe("cosmetics");
    expect(deriveSuggestedChannel({ liquid: true, alcohol: true })).toBe("liquid_perfume");
    expect(deriveSuggestedChannel({ ingestible: true })).toBe("sensitive_other");
    expect(deriveSuggestedChannel({ magnetic: true })).toBe("magnetic");
  });

  it("ignores alcohol when the product is not liquid", () => {
    expect(deriveSuggestedChannel({ alcohol: true })).toBe("standard");
    expect(deriveSuggestedChannel({ alcohol: true, magnetic: true })).toBe("magnetic");
  });

  it("applies the priority electronics > perfume > ingestible > cosmetics > magnetic", () => {
    expect(
      deriveSuggestedChannel({ electronics: true, liquid: true, alcohol: true, ingestible: true, magnetic: true }),
    ).toBe("electronics_battery");
    expect(deriveSuggestedChannel({ liquid: true, alcohol: true, ingestible: true, magnetic: true })).toBe(
      "liquid_perfume",
    );
    expect(deriveSuggestedChannel({ liquid: true, ingestible: true, magnetic: true })).toBe("sensitive_other");
    expect(deriveSuggestedChannel({ liquid: true, magnetic: true })).toBe("cosmetics");
  });
});

describe("parseProductAttributes", () => {
  it("returns all false for missing or malformed input", () => {
    expect(parseProductAttributes(undefined)).toEqual({
      electronics: false,
      liquid: false,
      alcohol: false,
      ingestible: false,
      magnetic: false,
    });
    expect(parseProductAttributes("x").magnetic).toBe(false);
  });

  it("only keeps alcohol alongside liquid and ignores truthy non-booleans", () => {
    expect(parseProductAttributes({ alcohol: true }).alcohol).toBe(false);
    expect(parseProductAttributes({ liquid: true, alcohol: true }).alcohol).toBe(true);
    expect(parseProductAttributes({ electronics: "yes" }).electronics).toBe(false);
  });

  it("lists ticked attributes for the sourcer view", () => {
    expect(tickedAttributes(parseProductAttributes({ liquid: true, alcohol: true, magnetic: true }))).toEqual([
      "liquid",
      "magnetic",
      "alcohol",
    ]);
  });
});

describe("estimateBasis (early estimate gating)", () => {
  it("is null once a real quote exists, whatever the brief says", () => {
    expect(estimateBasis({ approx_weight_g: 200, current_unit_cost: 3 }, true)).toBeNull();
  });

  it("requires an approximate weight", () => {
    expect(estimateBasis({ current_unit_cost: 3 }, false)).toBeNull();
    expect(estimateBasis({ approx_weight_g: 0, current_unit_cost: 3 }, false)).toBeNull();
  });

  it("requires a cost basis: current cost first, target price as fallback", () => {
    expect(estimateBasis({ approx_weight_g: 200 }, false)).toBeNull();
    expect(estimateBasis({ approx_weight_g: 200, target_unit_price: 4 }, false)).toMatchObject({
      unitCost: 4,
      unitCostSource: "target_unit_price",
    });
    expect(
      estimateBasis({ approx_weight_g: 200.4, current_unit_cost: 3, target_unit_price: 4 }, false),
    ).toEqual({
      weightG: 200,
      unitCost: 3,
      unitCostSource: "current_unit_cost",
      channel: "standard",
    });
  });

  it("uses the suggested channel when valid, standard otherwise", () => {
    expect(
      estimateBasis({ approx_weight_g: 50, current_unit_cost: 1, suggested_channel: "electronics_battery" }, false)
        ?.channel,
    ).toBe("electronics_battery");
    expect(
      estimateBasis({ approx_weight_g: 50, current_unit_cost: 1, suggested_channel: "bogus" }, false)?.channel,
    ).toBe("standard");
  });
});
