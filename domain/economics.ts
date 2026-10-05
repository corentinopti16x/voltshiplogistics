export type FinancialProfile = {
  psp_pct: number;
  urssaf_pct: number;
  vat_pct: number;
  other_pct: number;
  min_margin_pct: number;
  target_margin_pct: number;
};

export const DEFAULT_FINANCIAL_PROFILE: FinancialProfile = {
  psp_pct: 0,
  urssaf_pct: 0,
  vat_pct: 0,
  other_pct: 0,
  min_margin_pct: 15,
  target_margin_pct: 20,
};

export type Economics = {
  multiplier: number | null;
  totalFees: number | null;
  profit: number | null;
  roasBe: number | null;
  roasTarget: number | null;
  roasTargetLow: number | null;
  roasTargetHigh: number | null;
  maxAtc: number | null;
};

export function parseFinancialProfile(raw: unknown): FinancialProfile {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_FINANCIAL_PROFILE };
  const row = raw as Record<string, unknown>;
  const num = (key: keyof FinancialProfile, fallback: number) => {
    const value = Number(row[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    psp_pct: num("psp_pct", 0),
    urssaf_pct: num("urssaf_pct", 0),
    vat_pct: num("vat_pct", 0),
    other_pct: num("other_pct", 0),
    min_margin_pct: num("min_margin_pct", 15),
    target_margin_pct: num("target_margin_pct", 20),
  };
}

export function computeEconomics(
  sellingPrice: number,
  cogs: number | null,
  profile: FinancialProfile,
): Economics {
  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
    return {
      multiplier: null,
      totalFees: null,
      profit: null,
      roasBe: null,
      roasTarget: null,
      roasTargetLow: null,
      roasTargetHigh: null,
      maxAtc: null,
    };
  }

  const feeRate =
    (profile.psp_pct + profile.urssaf_pct + profile.vat_pct + profile.other_pct) /
    100;
  const totalFees = sellingPrice * feeRate;
  const profit = cogs == null ? null : sellingPrice - cogs - totalFees;
  const multiplier = cogs && cogs > 0 ? sellingPrice / cogs : null;
  const roasBe = profit && profit > 0 ? sellingPrice / profit : null;
  const targetSlice = (profile.target_margin_pct / 100) * sellingPrice;
  const targetProfit = profit == null ? null : profit - targetSlice;
  const roasTarget =
    targetProfit && targetProfit > 0 ? sellingPrice / targetProfit : null;

  return {
    multiplier,
    totalFees,
    profit,
    roasBe,
    roasTarget,
    roasTargetLow: roasTarget == null ? null : roasTarget * 0.8,
    roasTargetHigh: roasTarget == null ? null : roasTarget * 1.2,
    maxAtc: sellingPrice * 0.2,
  };
}

export function formatMetric(value: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function multiplierTone(multiplier: number | null) {
  if (multiplier == null) return "muted";
  if (multiplier < 2) return "red";
  if (multiplier < 3) return "orange";
  return "green";
}
