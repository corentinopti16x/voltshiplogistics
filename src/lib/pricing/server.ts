import "server-only";
import { resolveClientPricing } from "@/lib/domain/pricing-tiers";

import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/auth/audit";
import { notifyUnavailableCarrierLines } from "./carrier-check-server";
import {
  SCHEDULED_GRID_KEY,
  effectiveGridVersion,
  parseGridSchedule,
  scheduleIsDue,
  type GridSchedule,
} from "./grid-schedule";
import {
  COGS_MATRIX_QUANTITIES,
  announcedPriceFor,
  applyAnnouncedPrice,
  calculateCogs,
  hasInternalBattery,
  listRateOptions,
  normalizeDestination,
  activeAnnouncedPrices,
  parseDestinationMarkets,
  parseParcelDimensions,
  parcelWeightG,
  autoCarriersFor,
  calculateBundleCogs,
  gridChannel,
  parcelChannel,
  type BundleBreakdown,
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
import { parcelExtras } from "@/lib/products/extras";
import { GRAM_COLUMNS, isMissingGramColumns, parseGramArray } from "./gram-columns";

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
  /**
   * Cheaper price when the delivery postcode is covered by a line with limited coverage
   * (e.g. Huahan USA), which the automatic choice leaves out. Null when not cheaper / n.a.
   */
  covered?: CogsBreakdown | null;
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
  /** Carriers of the automatic choice on this market (null = all carriers). */
  autoCarriers?: string[] | null;
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

/**
 * Grid used for pricing now: `active_grid_version`, or the scheduled grid as soon as its
 * activation time has passed (the cron then makes it the active one).
 */
export async function getActiveGridVersion() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("pricing_meta")
    .select("key, value")
    .in("key", ["active_grid_version", SCHEDULED_GRID_KEY]);
  const rows = new Map((data ?? []).map((row) => [row.key as string, row.value as unknown]));
  const active = typeof rows.get("active_grid_version") === "string" ? (rows.get("active_grid_version") as string) : null;
  return effectiveGridVersion(active, parseGridSchedule(rows.get(SCHEDULED_GRID_KEY)));
}

/** Scheduled activation, or null. */
export async function getGridSchedule(): Promise<GridSchedule | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("pricing_meta").select("value").eq("key", SCHEDULED_GRID_KEY).maybeSingle();
  return parseGridSchedule(data?.value ?? null);
}

/**
 * Cron: once the scheduled time has passed, the scheduled grid becomes `active_grid_version`
 * and the schedule is cleared. Returns the activated version, or null when nothing was due.
 */
export async function applyScheduledGridActivation(now: Date = new Date()) {
  const schedule = await getGridSchedule();
  if (!schedule || !scheduleIsDue(schedule, now)) return null;
  const admin = createAdminClient();
  const { data: grid } = await admin
    .from("rate_grids")
    .select("grid_version")
    .eq("grid_version", schedule.gridVersion)
    .maybeSingle();
  if (!grid) {
    // The grid was deleted: drop the schedule rather than pricing on a missing grid.
    await admin.from("pricing_meta").delete().eq("key", SCHEDULED_GRID_KEY);
    return null;
  }
  const { error } = await admin
    .from("pricing_meta")
    .upsert({ key: "active_grid_version", value: schedule.gridVersion });
  if (error) throw error;
  await admin.from("pricing_meta").delete().eq("key", SCHEDULED_GRID_KEY);
  // Client carrier choices pointing at a line missing from the new grid → notification.
  await notifyUnavailableCarrierLines(schedule.gridVersion).catch(() => null);
  if (schedule.by) {
    await writeAudit({
      actorUserId: schedule.by,
      action: "pricing.grid.activate_scheduled",
      entity: "pricing_meta",
      diff: { active_grid_version: schedule.gridVersion, at: schedule.at },
    }).catch(() => null);
  }
  return schedule.gridVersion;
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
  return loadRateCellsFor(gridVersion, destinations, [channel]);
}

/**
 * Rate cells of the grid for these destinations × channels, paged (PostgREST returns at
 * most 1 000 rows per request and a grid has thousands of cells).
 */
export async function loadRateCellsFor(
  gridVersion: string,
  destinations: string[],
  channels: string[],
): Promise<RateCell[]> {
  if (destinations.length === 0 || channels.length === 0) return [];
  const admin = createAdminClient();
  type Row = {
    grid_version: string;
    carrier: string;
    destination: string;
    channel: string;
    weight_min_g: number;
    weight_max_g: number;
    price: number;
    delivery_range: string | null;
    line_name: string | null;
    ioss_required: boolean | null;
    carrier_cost_rmb: number | null;
    gram_prices?: unknown;
    gram_costs_rmb?: unknown;
  };
  const data: Row[] = [];
  let withGrams = true;
  for (let from = 0; from < 100_000; from += 1000) {
    const { data: page, error } = await admin
      .from("rate_grid_cells")
      .select(
        `id, grid_version, carrier, destination, channel, weight_min_g, weight_max_g, price, delivery_range, line_name, ioss_required, carrier_cost_rmb${withGrams ? `, ${GRAM_COLUMNS}` : ""}`,
      )
      .eq("grid_version", gridVersion)
      .in("destination", destinations)
      .in("channel", [...new Set(channels.map((channel) => gridChannel(channel)))])
      .order("id")
      .range(from, from + 999);
    if (error && withGrams && isMissingGramColumns(error)) {
      // Migration 00022 not applied yet: flat bracket prices.
      withGrams = false;
      from -= 1000;
      continue;
    }
    if (error) throw error;
    data.push(...((page ?? []) as unknown as Row[]));
    if (!page || page.length < 1000) break;
  }
  return data.map((cell) => ({
    gramPrices: parseGramArray(cell.gram_prices),
    gramCostsRmb: parseGramArray(cell.gram_costs_rmb),
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
        autoCarriers: null,
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
  // Box bought for the product (price + weight per unit) and packaging once per parcel.
  const extras = parcelExtras(product.quote_json, settings);

  return {
    activeGridVersion,
    gridEffectiveDate,
    quantities,
    missingReason: null,
    markets: markets.map((destination) => {
      const selection = resolveCarrierSelection(rules, preferences, destination);
      // Automatic choice limited to the market's full-coverage carriers (US: YunExpress, Tongyou).
      const autoCarriers = autoCarriersFor(settings.auto_carriers, destination);
      const common = {
        autoCarriers,
        weightG: unitWeightG,
        channel,
        destination,
        dimensionsCm,
        volumetricDivisors: settings.volumetric_divisors,
        carrierPreference: selection.preference,
        allowedLines,
        handlingLadder: handlingLadderFrom(settings),
        fxRmbPerEur: settings.fx_rmb_per_eur,
        batteryInternal: hasInternalBattery(product.quote_json),
        ...extras,
      };
      return {
        destination,
        preference: selection.preference,
        forced: selection.forced,
        autoCarriers,
        options: listRateOptions(cells, { ...common, weightG: parcelWeightG(unitWeightG, 1, extras), quantity: 1 }),
        cells: quantities.map((quantity) => {
          const computed = calculateCogs({ ...common, cells, clientPrice, quantity, ...profile });
          const announced = announcedPriceFor(announcedPrices, destination, quantity);
          // Same parcel with every line allowed: the price when the postcode is covered.
          const unrestricted =
            autoCarriers && !selection.preference && announced == null
              ? calculateCogs({ ...common, autoCarriers: null, cells, clientPrice, quantity, ...profile })
              : null;
          return {
            quantity,
            breakdown: computed && announced != null ? applyAnnouncedPrice(computed, announced) : computed,
            covered:
              unrestricted && (!computed || unrestricted.cogs < computed.cogs) ? unrestricted : null,
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

export type ComposedCogs = {
  breakdown: BundleBreakdown | null;
  missingReason: "product_data" | "grid" | "rate" | null;
  destination: string;
};

/**
 * COGS of one parcel: the main product + the upsells the client picked (quantities), on a
 * market. Same grid, palier, carrier rules and packaging as the product's own COGS; the line
 * follows the main product's choice. A battery item moves the parcel to the battery lines.
 */
export async function calculateComposedCogs(
  main: ProductRow,
  lines: Array<{ product: ProductRow; quantity: number }>,
  market: string,
): Promise<ComposedCogs> {
  const destination = normalizeDestination(market);
  const picked = lines.filter((line) => line.quantity > 0);
  const ready = picked.every(
    (line) => line.product.client_price != null && line.product.weight_g != null && !!line.product.shipping_channel,
  );
  if (picked.length === 0 || !ready) return { breakdown: null, missingReason: "product_data", destination };
  const [activeGridVersion, profile, settings, rules] = await Promise.all([
    getActiveGridVersion(),
    getClientPricingProfile(main.client_id),
    readPricingSettings(createAdminClient()),
    loadCarrierRules(main.client_id),
  ]);
  if (!activeGridVersion) return { breakdown: null, missingReason: "grid", destination };
  const channel = parcelChannel(picked.map((line) => line.product.shipping_channel)) ?? (main.shipping_channel as ShippingChannel);
  const cells = await loadRateCellsFor(activeGridVersion, [destination], [channel]);
  const selection = resolveCarrierSelection(rules, parseCarrierPreferences(main.quote_json), destination);
  const mainExtras = parcelExtras(main.quote_json, settings);
  const breakdown = calculateBundleCogs({
    items: picked.map((line) => {
      const extras = parcelExtras(line.product.quote_json, settings);
      return {
        productId: line.product.id,
        title: line.product.title,
        quantity: line.quantity,
        clientPrice: Number(line.product.client_price),
        weightG: Number(line.product.weight_g),
        boxPrice: extras.boxPrice,
        boxWeightG: extras.boxWeightG,
      };
    }),
    channel,
    destination,
    cells,
    carrierPreference: selection.preference,
    allowedLines: allowedLinesFromRules(cells, rules),
    autoCarriers: autoCarriersFor(settings.auto_carriers, destination),
    batteryInternal: picked.some((line) => hasInternalBattery(line.product.quote_json)),
    handlingLadder: handlingLadderFrom(settings),
    fxRmbPerEur: settings.fx_rmb_per_eur,
    volumetricDivisors: settings.volumetric_divisors,
    // The product's own packaging is exact for it alone; with upsells it is a minimum.
    packagingWeightG: picked.every((line) => line.product.id === main.id) ? mainExtras.packagingWeightG : null,
    packagingFloorG: mainExtras.packagingWeightG,
    packagingLadder: settings.packaging_ladder,
    ...profile,
  });
  return { breakdown, missingReason: breakdown ? null : "rate", destination };
}
