import "server-only";
import { resolveClientPricing } from "@/lib/domain/pricing-tiers";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  COGS_MATRIX_QUANTITIES,
  announcedPriceFor,
  applyAnnouncedPrice,
  calculateCogs,
  listRateOptions,
  normalizeDestination,
  activeAnnouncedPrices,
  parseDestinationMarkets,
  parseParcelDimensions,
  type CarrierLineRef,
  type CogsBreakdown,
  type RateCell,
  type RateOption,
  type ShippingChannel,
} from "@/lib/domain/pricing";
import {
  EMPTY_CARRIER_RULES,
  allowedLinesFromRules,
  parseCarrierPreferences,
  parseCarrierRules,
  resolveCarrierSelection,
  type CarrierPreferences,
  type CarrierRules,
} from "@/lib/domain/carrier-rules";
import { getProductRequest, type ProductRow } from "@/lib/products/types";
import { handlingLadderFrom, readPricingSettings } from "./settings";

export type ClientPricingProfile = {
  commissionPct: number;
  handlingFee: number;
  logisticsDiscountPct: number;
  /** Handling grows with the parcel (Ultra VIP / VIP) or stays fixed (Platinium / Gold). */
  handlingGrows?: boolean;
};

export type LiveProductQuote = {
  breakdown: CogsBreakdown | null;
  activeGridVersion: string | null;
  destination: string;
  missingReason: "product_data" | "grid" | "rate" | null;
};

export type CogsMatrixCell = {
  quantity: number;
  /** Live breakdown for a parcel of `quantity` units, or null when no weight bracket matches. */
  breakdown: CogsBreakdown | null;
};

export type CogsMatrixMarket = {
  destination: string;
  cells: CogsMatrixCell[];
  /** Lines able to ship 1 unit on this market (blocked lines removed), cheapest first. */
  options: RateOption[];
  /** Effective preference (forced line or the client's choice); null = cheapest. */
  preference: CarrierLineRef | null;
  /** True when Voltship forces the line on this market. */
  forced: boolean;
};

export type ProductCogsMatrix = {
  activeGridVersion: string | null;
  /** Effective date of the active grid (rate_grids.effective_date), when known. */
  gridEffectiveDate: string | null;
  /** Primary market first (the live single-unit quote uses it). */
  markets: CogsMatrixMarket[];
  quantities: number[];
  missingReason: "product_data" | "grid" | null;
};

function getDestination(product: ProductRow) {
  const quoteDestination = product.quote_json?.destination;
  if (typeof quoteDestination === "string" && quoteDestination.trim()) {
    return normalizeDestination(quoteDestination);
  }
  const request = product.quote_json?._request;
  if (request && typeof request === "object") {
    const raw = (request as Record<string, unknown>).destination_markets;
    if (typeof raw === "string" && raw.trim()) {
      return normalizeDestination(raw);
    }
  }
  return "FR";
}

export async function getActiveGridVersion() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("pricing_meta")
    .select("value")
    .eq("key", "active_grid_version")
    .maybeSingle();
  const version = data?.value;
  return version && version !== "uninitialized" ? version : null;
}

/** Admin carrier rules of a client (`clients.carrier_rules_json`); empty rules when unset. */
export async function loadCarrierRules(clientId: string): Promise<CarrierRules> {
  const admin = createAdminClient();
  const { data } = await admin.from("clients").select("carrier_rules_json").eq("id", clientId).maybeSingle();
  return parseCarrierRules(data?.carrier_rules_json);
}

export async function getClientPricingProfile(clientId: string): Promise<ClientPricingProfile> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("clients")
    .select("pricing_tier, commission_pct, handling_fee, logistics_discount_pct")
    .eq("id", clientId)
    .maybeSingle();
  // Unset fields take the palier's values (Gold by default): never 0 € handling by accident.
  return resolveClientPricing(data);
}

/** Markets of a product: brief `destination_markets` (fallback FR), primary market first. */
export function getProductMarkets(product: ProductRow) {
  const primary = getDestination(product);
  const fromBrief = parseDestinationMarkets(getProductRequest(product).destination_markets, primary);
  return [primary, ...fromBrief.filter((market) => market !== primary)];
}

export async function loadRateCells(
  gridVersion: string,
  destinations: string[],
  channel: string,
): Promise<RateCell[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("rate_grid_cells")
    .select(
      "grid_version, carrier, destination, channel, weight_min_g, weight_max_g, price, delivery_range, line_name, ioss_required, carrier_cost_rmb",
    )
    .eq("grid_version", gridVersion)
    .in("destination", destinations)
    .eq("channel", channel);
  return (data ?? []).map((cell) => ({
    gridVersion: cell.grid_version,
    carrier: cell.carrier,
    destination: cell.destination,
    channel: cell.channel as ShippingChannel,
    weightMinG: Number(cell.weight_min_g),
    weightMaxG: Number(cell.weight_max_g),
    price: Number(cell.price),
    deliveryRange: cell.delivery_range,
    lineName: cell.line_name || null,
    iossRequired: cell.ioss_required === true,
    // Internal: only used so the palier discount never prices transport below cost.
    carrierCostRmb: cell.carrier_cost_rmb == null ? null : Number(cell.carrier_cost_rmb),
  }));
}

async function getGridEffectiveDate(gridVersion: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("rate_grids")
    .select("effective_date")
    .eq("grid_version", gridVersion)
    .maybeSingle();
  return data?.effective_date ? String(data.effective_date) : null;
}

/**
 * COGS for 1..n units per market, always on the live grid. Same engine and same
 * carrier/channel selection as the single-unit quote (`calculateCogs` + `findRateCell`):
 * product × n, commission on the product, one parcel of n × unit weight, handling once
 * per order.
 */
export async function calculateProductCogsMatrix(
  product: ProductRow,
  options: {
    markets?: string[];
    quantities?: readonly number[];
    /** Override the product's stored `_carrier_pref` (default: read from quote_json). */
    carrierPreferences?: CarrierPreferences | null;
    /** Override the client's admin rules (default: loaded from `clients.carrier_rules_json`). */
    carrierRules?: CarrierRules | null;
    /**
     * Early-estimate overrides: run the same engine on client-declared values when
     * Voltship has not set weight/channel/price yet. `commissionPct` replaces the
     * client's sourcing commission (0 = no Voltship sourcing commission applied).
     */
    overrides?: {
      weightG?: number | null;
      channel?: ShippingChannel | null;
      clientPrice?: number | null;
      commissionPct?: number | null;
    };
  } = {},
): Promise<ProductCogsMatrix> {
  const markets = options.markets ?? getProductMarkets(product);
  const quantities = [...(options.quantities ?? COGS_MATRIX_QUANTITIES)];
  const preferences = options.carrierPreferences ?? parseCarrierPreferences(product.quote_json);
  const effective = {
    clientPrice: options.overrides?.clientPrice ?? product.client_price,
    weightG: options.overrides?.weightG ?? product.weight_g,
    channel: options.overrides?.channel ?? product.shipping_channel,
  };
  const emptyMarkets = (rules: CarrierRules) =>
    markets.map((destination) => {
      const selection = resolveCarrierSelection(rules, preferences, destination);
      return {
        destination,
        cells: quantities.map((quantity) => ({ quantity, breakdown: null })),
        options: [] as RateOption[],
        preference: selection.preference,
        forced: selection.forced,
      };
    });
  if (effective.clientPrice == null || effective.weightG == null || !effective.channel) {
    return {
      activeGridVersion: null,
      gridEffectiveDate: null,
      markets: emptyMarkets(options.carrierRules ?? EMPTY_CARRIER_RULES),
      quantities,
      missingReason: "product_data",
    };
  }

  const [activeGridVersion, baseProfile, settings, rules] = await Promise.all([
    getActiveGridVersion(),
    getClientPricingProfile(product.client_id),
    readPricingSettings(createAdminClient()),
    options.carrierRules ? Promise.resolve(options.carrierRules) : loadCarrierRules(product.client_id),
  ]);
  if (!activeGridVersion) {
    return {
      activeGridVersion: null,
      gridEffectiveDate: null,
      markets: emptyMarkets(rules),
      quantities,
      missingReason: "grid",
    };
  }
  const profile =
    options.overrides?.commissionPct != null
      ? { ...baseProfile, commissionPct: options.overrides.commissionPct }
      : baseProfile;

  const [cells, gridEffectiveDate] = await Promise.all([
    loadRateCells(activeGridVersion, markets, effective.channel),
    getGridEffectiveDate(activeGridVersion),
  ]);
  const unitWeightG = effective.weightG;
  const clientPrice = Number(effective.clientPrice);
  const channel = effective.channel as ShippingChannel;
  // Dimensions (cm) from quote_json, same keys as the ECCANG mapping → volumetric weight.
  const dimensionsCm = parseParcelDimensions(product.quote_json);
  // Prices promised to the client (fiche produit → « Prix annoncés ») win over the rule.
  const announcedPrices = activeAnnouncedPrices(product.quote_json);
  // Admin rules: blocked lines are removed from every selection (and from the options list).
  const allowedLines = allowedLinesFromRules(cells, rules);

  return {
    activeGridVersion,
    gridEffectiveDate,
    quantities,
    missingReason: null,
    markets: markets.map((destination) => {
      const selection = resolveCarrierSelection(rules, preferences, destination);
      const common = {
        weightG: unitWeightG,
        channel,
        destination,
        dimensionsCm,
        volumetricDivisors: settings.volumetric_divisors,
        carrierPreference: selection.preference,
        allowedLines,
        handlingLadder: handlingLadderFrom(settings),
        fxRmbPerEur: settings.fx_rmb_per_eur,
      };
      return {
        destination,
        preference: selection.preference,
        forced: selection.forced,
        options: listRateOptions(cells, { ...common, quantity: 1 }),
        cells: quantities.map((quantity) => {
          const computed = calculateCogs({ ...common, cells, clientPrice, quantity, ...profile });
          const announced = announcedPriceFor(announcedPrices, destination, quantity);
          return {
            quantity,
            breakdown: computed && announced != null ? applyAnnouncedPrice(computed, announced) : computed,
          };
        }),
      };
    }),
  };
}

/** Single-unit live quote on the primary market (quantity 1 of the matrix). */
export function liveQuoteFromMatrix(matrix: ProductCogsMatrix): LiveProductQuote {
  const primary = matrix.markets[0];
  const breakdown = primary?.cells.find((cell) => cell.quantity === 1)?.breakdown ?? null;
  return {
    breakdown,
    activeGridVersion: matrix.activeGridVersion,
    destination: primary?.destination ?? "FR",
    missingReason: matrix.missingReason ?? (breakdown ? null : "rate"),
  };
}

export async function calculateLiveProductQuote(
  product: ProductRow,
): Promise<LiveProductQuote> {
  const destination = getDestination(product);
  const matrix = await calculateProductCogsMatrix(product, {
    markets: [destination],
    quantities: [1],
  });
  return liveQuoteFromMatrix(matrix);
}
