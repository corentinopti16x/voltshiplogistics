/**
 * Paliers clients Voltship (règle validée le 5 oct. 2026) :
 *   transport = grille ÷ 7,5 + max(10 % ; 0,60 €) − remise logistique du palier
 *   produit   = prix usine ÷ 7,5 × (1 + commission du palier)
 *   handling  = 1 € par colis pour tous
 * Le palier pré-remplit les tarifs du client ; ils restent ajustables à la main.
 */
export const PRICING_TIERS = ["ultra_vip", "vip", "platinium", "gold"] as const;
export type PricingTier = (typeof PRICING_TIERS)[number];

export const PRICING_TIER_LABELS: Record<PricingTier, string> = {
  ultra_vip: "Ultra VIP",
  vip: "VIP",
  platinium: "Platinium",
  gold: "Gold",
};

export type PricingTierPreset = {
  logisticsDiscountPct: number;
  commissionPct: number;
  handlingFee: number;
};

export const PRICING_TIER_PRESETS: Record<PricingTier, PricingTierPreset> = {
  ultra_vip: { logisticsDiscountPct: 10, commissionPct: 3, handlingFee: 1 },
  vip: { logisticsDiscountPct: 5, commissionPct: 5, handlingFee: 1 },
  platinium: { logisticsDiscountPct: 0, commissionPct: 7, handlingFee: 1 },
  gold: { logisticsDiscountPct: 0, commissionPct: 10, handlingFee: 1 },
};

export function parsePricingTier(value: unknown): PricingTier | null {
  return typeof value === "string" && (PRICING_TIERS as readonly string[]).includes(value)
    ? (value as PricingTier)
    : null;
}

/** Best guess from the client's pricing when no palier is stored yet. */
export function inferPricingTier(pricing: {
  commissionPct?: number | string | null;
  logisticsDiscountPct?: number | string | null;
}): PricingTier {
  const discount = Number(pricing.logisticsDiscountPct) || 0;
  const commission = pricing.commissionPct == null ? null : Number(pricing.commissionPct);
  if (discount >= 10) return "ultra_vip";
  if (discount >= 5) return "vip";
  if (commission != null && Number.isFinite(commission) && commission > 0) {
    if (commission <= 3) return "ultra_vip";
    if (commission <= 5) return "vip";
    if (commission <= 7) return "platinium";
  }
  return "gold";
}

export function pricingTierLabel(tier: PricingTier | null | undefined) {
  return tier ? PRICING_TIER_LABELS[tier] : "—";
}

/**
 * Client pricing with the palier's values wherever a field was never set (null), so a client
 * without saved tariffs is never priced at 0 € handling / 0 % commission by accident.
 * An explicit 0 saved on the client stays 0.
 */
export function resolveClientPricing(row: {
  pricing_tier?: unknown;
  commission_pct?: number | string | null;
  handling_fee?: number | string | null;
  logistics_discount_pct?: number | string | null;
} | null | undefined): PricingTierPreset {
  const tier =
    parsePricingTier(row?.pricing_tier) ??
    inferPricingTier({
      commissionPct: row?.commission_pct ?? null,
      logisticsDiscountPct: row?.logistics_discount_pct ?? null,
    });
  const preset = PRICING_TIER_PRESETS[tier];
  const pick = (value: number | string | null | undefined, fallback: number) => {
    if (value == null || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    commissionPct: pick(row?.commission_pct, preset.commissionPct),
    handlingFee: pick(row?.handling_fee, preset.handlingFee),
    logisticsDiscountPct: pick(row?.logistics_discount_pct, preset.logisticsDiscountPct),
  };
}
