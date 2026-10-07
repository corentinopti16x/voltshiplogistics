import { describe, expect, it } from "vitest";
import { PRICING_TIER_PRESETS, inferPricingTier, parsePricingTier } from "./pricing-tiers";

describe("pricing tiers", () => {
  it("presets follow the validated rule", () => {
    expect(PRICING_TIER_PRESETS.ultra_vip).toEqual({ logisticsDiscountPct: 10, commissionPct: 3, handlingFee: 1 });
    expect(PRICING_TIER_PRESETS.vip).toEqual({ logisticsDiscountPct: 5, commissionPct: 5, handlingFee: 1 });
    expect(PRICING_TIER_PRESETS.platinium).toEqual({ logisticsDiscountPct: 0, commissionPct: 7, handlingFee: 1 });
    expect(PRICING_TIER_PRESETS.gold).toEqual({ logisticsDiscountPct: 0, commissionPct: 10, handlingFee: 1 });
  });

  it("infers the palier from existing prices", () => {
    expect(inferPricingTier({ commissionPct: "5.000", logisticsDiscountPct: "5.000" })).toBe("vip");
    expect(inferPricingTier({ commissionPct: 7, logisticsDiscountPct: 0 })).toBe("platinium");
    expect(inferPricingTier({ commissionPct: 3, logisticsDiscountPct: 10 })).toBe("ultra_vip");
    expect(inferPricingTier({ commissionPct: null, logisticsDiscountPct: null })).toBe("gold");
    expect(inferPricingTier({ commissionPct: 10, logisticsDiscountPct: 0 })).toBe("gold");
  });

  it("parses only known paliers", () => {
    expect(parsePricingTier("vip")).toBe("vip");
    expect(parsePricingTier("bronze")).toBeNull();
  });
});
