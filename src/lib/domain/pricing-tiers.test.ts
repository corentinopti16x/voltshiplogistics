import { describe, expect, it } from "vitest";
import {
  PRICING_TIER_PRESETS,
  inferPricingTier,
  parsePricingTier,
  resolveClientPricing,
} from "./pricing-tiers";

describe("pricing tiers", () => {
  it("presets follow the validated rule", () => {
    expect(PRICING_TIER_PRESETS.ultra_vip).toEqual({ logisticsDiscountPct: 10, commissionPct: 3, handlingFee: 1, handlingGrows: true });
    expect(PRICING_TIER_PRESETS.vip).toEqual({ logisticsDiscountPct: 5, commissionPct: 5, handlingFee: 1, handlingGrows: true });
    expect(PRICING_TIER_PRESETS.platinium).toEqual({ logisticsDiscountPct: 0, commissionPct: 7, handlingFee: 1, handlingGrows: false });
    expect(PRICING_TIER_PRESETS.gold).toEqual({ logisticsDiscountPct: 0, commissionPct: 10, handlingFee: 1, handlingGrows: false });
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

  it("fills unset tariffs with the palier, keeps explicit values", () => {
    expect(resolveClientPricing({ pricing_tier: "gold", commission_pct: null, handling_fee: null, logistics_discount_pct: null }))
      .toEqual({ commissionPct: 10, handlingFee: 1, logisticsDiscountPct: 0, handlingGrows: false });
    expect(resolveClientPricing({ pricing_tier: "vip", commission_pct: "5.000", handling_fee: "1.0000", logistics_discount_pct: "5.000" }))
      .toEqual({ commissionPct: 5, handlingFee: 1, logisticsDiscountPct: 5, handlingGrows: true });
    expect(resolveClientPricing({ pricing_tier: "vip", commission_pct: 0, handling_fee: 1.7, logistics_discount_pct: 5 }))
      .toEqual({ commissionPct: 0, handlingFee: 1.7, logisticsDiscountPct: 5, handlingGrows: true });
    expect(resolveClientPricing(null)).toEqual({ commissionPct: 10, handlingFee: 1, logisticsDiscountPct: 0, handlingGrows: false });
  });
});
