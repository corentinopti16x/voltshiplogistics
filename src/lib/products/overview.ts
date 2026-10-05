import "server-only";

import {
  computeEconomics,
  parseFinancialProfile,
  type Economics,
  type FinancialProfile,
} from "@/lib/domain/economics";
import { parseAcceptedQuoteSnapshot } from "@/lib/domain/pricing";
import {
  calculateProductCogsMatrix,
  loadCarrierRules,
  getProductMarkets,
  liveQuoteFromMatrix,
  type ProductCogsMatrix,
} from "@/lib/pricing/server";
import { loadShopifyImagesForProducts } from "@/lib/shopify/images";
import {
  getTenantProductMetrics,
  listTenantProducts,
  type ProductMetrics,
} from "@/lib/products/queries";
import {
  getProductRequest,
  isQuoteAccepted,
  isQuoteReady,
  isSourcingOpen,
  type ProductRow,
} from "@/lib/products/types";
import { estimateBasis, type EstimateBasis } from "@/lib/products/attributes";
import { createAdminClient } from "@/lib/supabase/admin";
import { carrierLineLabel, type CarrierRules } from "@/lib/domain/carrier-rules";

/** Everything a product card needs, assembled from the existing queries/economics. */
export type ProductInsight = {
  product: ProductRow;
  metrics: ProductMetrics | null;
  /** COGS per unit: frozen accepted quote when present, otherwise the live grid quote. */
  cogs: number | null;
  cogsSource: "accepted" | "live" | null;
  economics: Economics;
  quotePending: boolean;
  sourcingOpen: boolean;
  /** Primary market of the product (brief destination_markets, fallback FR). */
  primaryMarket: string;
  /** Live COGS per order for 1..5 units on the primary market (null = no rate for that weight). */
  cogsLadder: Array<{ quantity: number; cogs: number | null }>;
  /** Shopify images when the product is linked to a Shopify variant (hot-linked). */
  shopifyImages: string[];
  /** Carrier line chosen (or forced) on the primary market, e.g. "YunExpress CHC"; null = cheapest (auto). */
  carrierLine: string | null;
  /**
   * Early estimate before sourcing: null as soon as a real (live or accepted) quote
   * exists, or when the brief lacks approx weight / cost basis. Never a quote.
   */
  estimate: ProductEstimate | null;
};

export type ProductEstimate = {
  basis: EstimateBasis;
  /** Estimated COGS per unit on the primary market (grid at suggested channel × approx weight, no sourcing commission). */
  cogs: number | null;
  economics: Economics;
  /** Why no figure could be computed (grid missing / no rate for that weight). */
  missingReason: "grid" | "rate" | null;
};

/**
 * Runs the regular COGS engine on the client-declared values (suggested channel,
 * approximate weight, current unit cost or target price) with no Voltship sourcing
 * commission. Returns null when the product already has a real quote or lacks inputs.
 */
export async function calculateProductEstimate(
  product: ProductRow,
  options: { markets?: string[]; carrierRules?: CarrierRules | null; profile: FinancialProfile },
): Promise<ProductEstimate | null> {
  const basis = estimateBasis(getProductRequest(product), isQuoteReady(product) || isQuoteAccepted(product));
  if (!basis) return null;
  const matrix = await calculateProductCogsMatrix(product, {
    markets: options.markets ?? getProductMarkets(product).slice(0, 1),
    quantities: [1],
    carrierRules: options.carrierRules,
    overrides: {
      weightG: basis.weightG,
      channel: basis.channel,
      clientPrice: basis.unitCost,
      commissionPct: 0,
    },
  });
  const live = liveQuoteFromMatrix(matrix);
  const cogs = live.breakdown?.cogs ?? null;
  return {
    basis,
    cogs,
    economics: computeEconomics(product.selling_price ?? 0, cogs, options.profile),
    missingReason: live.missingReason === "grid" ? "grid" : cogs == null ? "rate" : null,
  };
}

export async function loadProductInsights(clientId: string) {
  const products = await listTenantProducts(clientId);
  const admin = createAdminClient();
  const carrierRules = await loadCarrierRules(clientId);
  const [{ data: client }, metrics, matrices, shopifyImages] = await Promise.all([
    admin
      .from("clients")
      .select("financial_profile_json")
      .eq("id", clientId)
      .maybeSingle(),
    getTenantProductMetrics(clientId, products),
    // Primary market only: the card ladder and the single-unit live quote come from one call.
    // Carrier rules loaded once for the whole list; the product preference is read from quote_json.
    Promise.all(
      products.map((product) =>
        calculateProductCogsMatrix(product, { markets: getProductMarkets(product).slice(0, 1), carrierRules }),
      ),
    ),
    loadShopifyImagesForProducts(clientId, products).catch(() => new Map<string, string[]>()),
  ]);
  const profile = parseFinancialProfile(client?.financial_profile_json);
  const estimates = await Promise.all(
    products.map((product) => calculateProductEstimate(product, { carrierRules, profile })),
  );
  const insights = products.map((product, index) =>
    buildInsight(product, metrics.get(product.id) ?? null, matrices[index], profile, {
      shopifyImages: shopifyImages.get(product.id) ?? [],
      estimate: estimates[index],
    }),
  );
  return { products, insights, profile };
}

export function buildInsight(
  product: ProductRow,
  metrics: ProductMetrics | null,
  matrix: ProductCogsMatrix | null,
  profile: FinancialProfile,
  extras: { shopifyImages?: string[]; estimate?: ProductEstimate | null } = {},
): ProductInsight {
  const accepted = parseAcceptedQuoteSnapshot(product.accepted_quote_snapshot_json);
  const liveCogs = matrix ? liveQuoteFromMatrix(matrix).breakdown?.cogs ?? null : null;
  const cogs = accepted ? accepted.cogs : liveCogs;
  const cogsSource = accepted ? "accepted" : liveCogs != null ? "live" : null;
  const primary = matrix?.markets[0];
  return {
    product,
    metrics,
    cogs,
    cogsSource,
    economics: computeEconomics(product.selling_price ?? 0, cogs, profile),
    quotePending:
      isQuoteReady(product) && !isQuoteAccepted(product) && product.sourcing_status === "quote_sent",
    sourcingOpen: isSourcingOpen(product.sourcing_status),
    primaryMarket: primary?.destination ?? "FR",
    cogsLadder: (primary?.cells ?? []).map((cell) => ({
      quantity: cell.quantity,
      cogs: cell.breakdown?.cogs ?? null,
    })),
    shopifyImages: extras.shopifyImages ?? [],
    carrierLine: primary?.preference ? carrierLineLabel(primary.preference) : null,
    // The estimate disappears as soon as a real COGS exists.
    estimate: cogs == null ? extras.estimate ?? null : null,
  };
}
