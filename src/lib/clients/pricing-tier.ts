import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { inferPricingTier, parsePricingTier, type PricingTier } from "@/lib/domain/pricing-tiers";

/**
 * Palier per client id. Reads clients.pricing_tier (migration 00016); before that column exists,
 * or when it is empty, the palier is inferred from the client's commission / remise.
 */
export async function loadPricingTiers(clientIds: string[]): Promise<Map<string, PricingTier>> {
  const out = new Map<string, PricingTier>();
  if (clientIds.length === 0) return out;
  const admin = createAdminClient();
  const { data: pricing } = await admin
    .from("clients")
    .select("id, commission_pct, logistics_discount_pct")
    .in("id", clientIds);
  for (const row of pricing ?? []) {
    out.set(
      row.id,
      inferPricingTier({
        commissionPct: row.commission_pct,
        logisticsDiscountPct: row.logistics_discount_pct,
      }),
    );
  }
  const { data: stored, error } = await admin
    .from("clients")
    .select("id, pricing_tier")
    .in("id", clientIds);
  if (!error) {
    for (const row of (stored ?? []) as Array<{ id: string; pricing_tier: unknown }>) {
      const tier = parsePricingTier(row.pricing_tier);
      if (tier) out.set(row.id, tier);
    }
  }
  return out;
}

/** True when the error says clients.pricing_tier does not exist yet (migration 00016 not run). */
export function isMissingPricingTierColumn(error: { message?: string } | null | undefined) {
  return Boolean(error?.message && /pricing_tier/.test(error.message));
}
