"use server";

import { getAuthContext } from "@/lib/auth/context";
import { EMPTY_CARRIER_RULES } from "@/lib/domain/carrier-rules";
import { PRICING_TIER_PRESETS, parsePricingTier } from "@/lib/domain/pricing-tiers";
import { calculateProductCogsMatrix } from "@/lib/pricing/server";
import { readPricingSettings } from "@/lib/pricing/settings";
import { loadTransportOverview } from "@/lib/pricing/transport-server";
import type { ProductRow } from "@/lib/products/types";
import {
  PROPOSAL_MAX_ITEMS,
  PROPOSAL_QUANTITIES,
  cleanProposalItem,
  cleanProposalMarkets,
  type ProposalItemInput,
} from "@/lib/proposal/core";
import { createAdminClient } from "@/lib/supabase/admin";

export type ProposalCell = { quantity: number; total: number; perUnit: number };

export type ProposalMarket = {
  destination: string;
  /** Delivery time of the line used for 1 unit (« 7-12 »), when the grid gives it. */
  delivery: string | null;
  /** Split of the 1-unit price: product, shipping, handling (handling includes the service fee). */
  unit: { product: number; shipping: number; handling: number } | null;
  /** One entry per parcel size, null when no line carries that weight. */
  cells: (ProposalCell | null)[];
};

export type ProposalProduct = {
  name: string;
  weightG: number;
  channel: string;
  markets: ProposalMarket[];
};

export type ProposalResult =
  | { ok: true; products: ProposalProduct[] }
  | { ok: false; error: "forbidden" | "empty" | "markets" | "grid" | "failed" };

/**
 * Prices of a proposal for a prospect: the same engine as the product pages, run on values
 * typed by the team, with the palier's preset instead of a client. Nothing is saved.
 */
export async function buildProposalAction(input: {
  tier: string;
  markets: string[];
  items: ProposalItemInput[];
}): Promise<ProposalResult> {
  const ctx = await getAuthContext();
  if (!ctx || (ctx.role !== "sourcer" && ctx.role !== "voltship_admin")) {
    return { ok: false, error: "forbidden" };
  }
  try {
    const [settings, overview] = await Promise.all([
      readPricingSettings(createAdminClient()),
      loadTransportOverview(null, null, { withClientPrices: false }),
    ]);
    if (!overview.gridVersion) return { ok: false, error: "grid" };
    const markets = cleanProposalMarkets(
      input.markets ?? [],
      overview.destinations.map((item) => item.code),
    );
    if (markets.length === 0) return { ok: false, error: "markets" };
    const items = (input.items ?? [])
      .slice(0, PROPOSAL_MAX_ITEMS)
      .map((item) => cleanProposalItem(item, settings.fx_rmb_per_eur))
      .filter((item) => item != null);
    if (items.length === 0) return { ok: false, error: "empty" };
    const pricingProfile = PRICING_TIER_PRESETS[parsePricingTier(input.tier) ?? "gold"];

    const products: ProposalProduct[] = [];
    for (const item of items) {
      const draft = {
        id: "proposal",
        client_id: "",
        title: item.name,
        client_price: item.priceEur,
        weight_g: item.weightG,
        shipping_channel: item.channel,
        quote_json: {},
      } as unknown as ProductRow;
      const matrix = await calculateProductCogsMatrix(draft, {
        markets,
        quantities: PROPOSAL_QUANTITIES,
        carrierPreferences: {},
        carrierRules: EMPTY_CARRIER_RULES,
        pricingProfile,
      });
      if (matrix.missingReason === "grid") return { ok: false, error: "grid" };
      products.push({
        name: item.name,
        weightG: item.weightG,
        channel: item.channel,
        markets: matrix.markets.map((market) => {
          const one = market.cells.find((cell) => cell.quantity === 1)?.breakdown ?? null;
          return {
            destination: market.destination,
            delivery: one?.deliveryRange ?? null,
            unit: one
              ? {
                  product: one.product + (one.box ?? 0),
                  shipping: one.shipping,
                  handling: one.handling + one.commission,
                }
              : null,
            cells: market.cells.map((cell) =>
              cell.breakdown
                ? { quantity: cell.quantity, total: cell.breakdown.cogs, perUnit: cell.breakdown.cogsPerUnit }
                : null,
            ),
          };
        }),
      });
    }
    return { ok: true, products };
  } catch {
    return { ok: false, error: "failed" };
  }
}
