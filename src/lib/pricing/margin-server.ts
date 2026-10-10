import "server-only";
import { resolveClientPricing } from "@/lib/domain/pricing-tiers";
import { loadProductSkus } from "@/lib/products/skus";

/**
 * Voltship margin loaders — CONFIDENTIAL. Every loader calls `assertVoltshipAdmin()`
 * and throws for any other role (sourcer, owner, staff, impersonated admin included):
 * the figures include factory purchase prices and raw carrier costs. Never call these
 * from a client-facing page, component or API route.
 */

import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  COGS_MATRIX_QUANTITIES,
  announcedPriceFor,
  applyAnnouncedPrice,
  calculateCogs,
  hasInternalBattery,
  discountedShipping,
  FLAT_HANDLING,
  handlingForQuantity,
  findRateCell,
  parcelWeightG as parcelWeightOf,
  activeAnnouncedPrices,
  classifyAnnouncedPrice,
  parseAnnouncedPrices,
  parseAnnouncedUntil,
  parseParcelDimensions,
  todayIso,
  type AnnouncedAlertStatus,
  type RateCell,
  type ShippingChannel,
} from "@/lib/domain/pricing";
import {
  getActiveGridVersion,
  getClientPricingProfile,
  getProductMarkets,
  loadCarrierRules,
  type ClientPricingProfile,
} from "@/lib/pricing/server";
import {
  EMPTY_CARRIER_RULES,
  allowedLinesFromRules,
  parseCarrierPreferences,
  parseCarrierRules,
  resolveCarrierSelection,
  type CarrierRules,
} from "@/lib/domain/carrier-rules";
import { handlingLadderFrom, readPricingSettings, type PricingSettings } from "@/lib/pricing/settings";
import { CLIENT_PRODUCT_SELECT, serializeClientProduct } from "@/lib/products/visibility";
import { parcelExtras, productBox } from "@/lib/products/extras";
import type { ProductRow } from "@/lib/products/types";
import { unpackOrderLines, type OrderShipping } from "@/lib/shopify/order-cache";
import {
  computeVoltshipMargin,
  extractCarrierCostRmb,
  sumMargins,
  type MarginTotals,
  type VoltshipMargin,
} from "@/lib/pricing/margin";

export class MarginAccessError extends Error {
  constructor() {
    super("Voltship margin data is restricted to voltship_admin.");
    this.name = "MarginAccessError";
  }
}

/** Throws unless the session is a Voltship admin that is NOT impersonating a client. */
export async function assertVoltshipAdmin() {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "voltship_admin" || ctx.impersonating) throw new MarginAccessError();
  return ctx;
}

// ---------------------------------------------------------------------------
// Internal data access
// ---------------------------------------------------------------------------

/** Rate cells WITH the internal carrier cost and tax flag (never used by client loaders). */
async function loadInternalRateCells(
  gridVersion: string,
  destinations: string[],
  channels: string[],
): Promise<RateCell[]> {
  if (destinations.length === 0 || channels.length === 0) return [];
  const admin = createAdminClient();
  // Paged: a grid has thousands of cells and PostgREST returns 1 000 rows per request.
  const data: Array<Record<string, unknown> & {
    grid_version: string;
    carrier: string;
    destination: string;
    channel: string;
    delivery_range: string | null;
    line_name: string | null;
  }> = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data: page, error } = await admin
      .from("rate_grid_cells")
      .select(
        "id, grid_version, carrier, destination, channel, weight_min_g, weight_max_g, price, delivery_range, line_name, carrier_cost_rmb, tax_included, ioss_required",
      )
      .eq("grid_version", gridVersion)
      .in("destination", destinations)
      .in("channel", channels)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    data.push(...((page ?? []) as typeof data));
    if (!page || page.length < 1000) break;
  }
  return data.map((cell) => ({
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
    carrierCostRmb: cell.carrier_cost_rmb == null ? null : Number(cell.carrier_cost_rmb),
    taxIncluded: cell.tax_included !== false,
  }));
}

async function loadFactoryPrices(productIds: string[]) {
  const map = new Map<string, number | null>();
  if (productIds.length === 0) return map;
  const admin = createAdminClient();
  const { data } = await admin
    .from("sourcing_work")
    .select("product_id, factory_purchase_price")
    .in("product_id", productIds);
  for (const row of data ?? []) {
    const value = Number(row.factory_purchase_price);
    map.set(row.product_id, row.factory_purchase_price != null && Number.isFinite(value) ? value : null);
  }
  return map;
}

async function loadAdminProducts(filter: {
  clientId?: string;
  clientIds?: string[];
  productId?: string;
  includeArchived?: boolean;
}) {
  const admin = createAdminClient();
  let query = admin.from("products_cache").select(CLIENT_PRODUCT_SELECT);
  if (filter.clientId) query = query.eq("client_id", filter.clientId);
  if (filter.clientIds) query = query.in("client_id", filter.clientIds);
  if (filter.productId) query = query.eq("id", filter.productId);
  if (!filter.includeArchived) query = query.neq("lifecycle_status", "archived");
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => serializeClientProduct(row));
}

/** Units sold per SKU over the last `days` days (sales_cache). */
async function loadUnitsSold(clientId: string, days: number) {
  const admin = createAdminClient();
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  const { data } = await admin
    .from("sales_cache")
    .select("sku, units_sold")
    .eq("client_id", clientId)
    .gte("date", since.toISOString().slice(0, 10));
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    if (!row.sku) continue;
    map.set(row.sku, (map.get(row.sku) ?? 0) + (Number(row.units_sold) || 0));
  }
  return map;
}

type ProductContext = {
  product: ProductRow;
  factoryPriceRmb: number | null;
  profile: ClientPricingProfile;
  cells: RateCell[];
  /** Client carrier rules (forced / blocked lines); the product's own choice is in quote_json. */
  rules?: CarrierRules;
};

/**
 * Line choice of a product on a market — exactly what the client's product page uses:
 * forced line, else the chosen line (`_carrier_pref`), else the cheapest allowed line.
 */
function carrierChoice(product: ProductRow, destination: string, cells: RateCell[], rules?: CarrierRules) {
  const effective = rules ?? EMPTY_CARRIER_RULES;
  const selection = resolveCarrierSelection(effective, parseCarrierPreferences(product.quote_json), destination);
  return {
    carrierPreference: selection.preference,
    allowedLines: allowedLinesFromRules(cells, effective),
  };
}

/** Client-facing breakdown + the matching cell's internal cost → margin, for one parcel. */
function marginForParcel(
  ctx: ProductContext,
  destination: string,
  quantity: number,
  settings: PricingSettings,
): VoltshipMargin {
  const { product, profile, cells } = ctx;
  const choice = carrierChoice(product, destination, cells, ctx.rules);
  const ready = product.client_price != null && product.weight_g != null && !!product.shipping_channel;
  const channel = (product.shipping_channel ?? "standard") as ShippingChannel;
  const unitWeightG = product.weight_g ?? 0;
  const dimensionsCm = parseParcelDimensions(product.quote_json);
  // Box (bought per unit, billed with the product) + packaging once per parcel.
  const extras = parcelExtras(product.quote_json, settings);
  const boxRmb = productBox(product.quote_json)?.priceRmb ?? 0;
  // Same engine as the client quote: product × n, commission on product, one parcel, handling once.
  const computed = ready
    ? calculateCogs({
        clientPrice: Number(product.client_price),
        weightG: unitWeightG,
        channel,
        destination,
        cells,
        quantity,
        dimensionsCm,
        volumetricDivisors: settings.volumetric_divisors,
        handlingLadder: handlingLadderFrom(settings),
        fxRmbPerEur: settings.fx_rmb_per_eur,
        batteryInternal: hasInternalBattery(product.quote_json),
        ...extras,
        ...choice,
        ...profile,
      })
    : null;
  const announced = announcedPriceFor(activeAnnouncedPrices(product.quote_json), destination, quantity);
  const breakdown = computed && announced != null ? applyAnnouncedPrice(computed, announced) : computed;
  // Same cell selection as calculateCogs (findRateCell on the billed parcel weight) to read
  // the internal carrier cost of the cell the client price came from.
  const parcelWeightG = parcelWeightOf(unitWeightG, quantity, extras);
  const cell =
    breakdown && unitWeightG > 0
      ? findRateCell(cells, {
          weightG: parcelWeightG,
          quantity,
          dimensionsCm,
          volumetricDivisors: settings.volumetric_divisors,
          channel,
          destination,
          batteryInternal: hasInternalBattery(product.quote_json),
          ...choice,
        })
      : null;
  return computeVoltshipMargin({
    quantity,
    // The box is packaging re-billed at cost: its price sits with the product side, against
    // its RMB cost in the factory cost, so it nets to ~0 in the margin.
    client: breakdown ? { ...breakdown, product: breakdown.product + (breakdown.box ?? 0) } : null,
    factoryCostRmb: ctx.factoryPriceRmb == null ? null : (ctx.factoryPriceRmb + boxRmb) * quantity,
    carrierCostRmb: cell?.carrierCostRmb ?? null,
    carrierCostSource: cell?.carrierCostRmb != null ? "grid" : null,
    taxIncluded: cell?.taxIncluded !== false,
    settings,
  });
}

// ---------------------------------------------------------------------------
// Per product: markets × quantities 1..5
// ---------------------------------------------------------------------------

export type ProductMarginMatrix = {
  product: ProductRow;
  clientName: string;
  factoryPriceRmb: number | null;
  factoryPriceEur: number | null;
  settings: PricingSettings;
  activeGridVersion: string | null;
  quantities: number[];
  markets: Array<{ destination: string; cells: VoltshipMargin[] }>;
};

export async function loadProductMarginMatrix(productId: string): Promise<ProductMarginMatrix | null> {
  await assertVoltshipAdmin();
  const [product] = await loadAdminProducts({ productId, includeArchived: true });
  if (!product) return null;
  const admin = createAdminClient();
  const [settings, activeGridVersion, profile, factoryPrices, clientRow, rules] = await Promise.all([
    readPricingSettings(admin),
    getActiveGridVersion(),
    getClientPricingProfile(product.client_id),
    loadFactoryPrices([product.id]),
    admin.from("clients").select("name").eq("id", product.client_id).maybeSingle(),
    loadCarrierRules(product.client_id),
  ]);
  const markets = getProductMarkets(product);
  const cells =
    activeGridVersion && product.shipping_channel
      ? await loadInternalRateCells(activeGridVersion, markets, [product.shipping_channel])
      : [];
  const factoryPriceRmb = factoryPrices.get(product.id) ?? null;
  const ctx: ProductContext = { product, factoryPriceRmb, profile, cells, rules };
  const quantities = [...COGS_MATRIX_QUANTITIES];
  return {
    product,
    clientName: clientRow.data?.name ?? "",
    factoryPriceRmb,
    factoryPriceEur: factoryPriceRmb == null ? null : factoryPriceRmb / settings.fx_rmb_per_eur,
    settings,
    activeGridVersion,
    quantities,
    markets: markets.map((destination) => ({
      destination,
      cells: quantities.map((quantity) => marginForParcel(ctx, destination, quantity, settings)),
    })),
  };
}

// ---------------------------------------------------------------------------
// Per client: one row per product (primary market, quantity 1), weighted by 30-day sales
// ---------------------------------------------------------------------------

export type ClientMarginRow = {
  product: ProductRow;
  market: string;
  factoryPriceRmb: number | null;
  /** Units sold over the window (sales_cache); 0 when no sales data. */
  unitsSold: number;
  margin: VoltshipMargin;
};

export type ClientMargin = {
  clientId: string;
  settings: PricingSettings;
  activeGridVersion: string | null;
  windowDays: number;
  rows: ClientMarginRow[];
  /** Weighted by units sold when any product sold in the window, otherwise one unit each. */
  totals: MarginTotals;
  weightedBySales: boolean;
};

export async function loadClientMargin(clientId: string, windowDays = 30): Promise<ClientMargin> {
  await assertVoltshipAdmin();
  const admin = createAdminClient();
  const [products, settings, activeGridVersion, profile, unitsSold, rules] = await Promise.all([
    loadAdminProducts({ clientId }),
    readPricingSettings(admin),
    getActiveGridVersion(),
    getClientPricingProfile(clientId),
    loadUnitsSold(clientId, windowDays),
    loadCarrierRules(clientId),
  ]);
  const factoryPrices = await loadFactoryPrices(products.map((product) => product.id));
  const markets = [...new Set(products.map((product) => getProductMarkets(product)[0]))];
  const channels = [...new Set(products.map((product) => product.shipping_channel).filter(Boolean))] as string[];
  const cells = activeGridVersion ? await loadInternalRateCells(activeGridVersion, markets, channels) : [];

  const productSkus = await loadProductSkus(products);
  const rows: ClientMarginRow[] = products.map((product) => {
    const factoryPriceRmb = factoryPrices.get(product.id) ?? null;
    const market = getProductMarkets(product)[0];
    const units = (productSkus.get(product.id) ?? []).reduce(
      (sum, sku) => sum + (unitsSold.get(sku) ?? 0),
      0,
    );
    return {
      product,
      market,
      factoryPriceRmb,
      unitsSold: units,
      margin: marginForParcel({ product, factoryPriceRmb, profile, cells, rules }, market, 1, settings),
    };
  });
  const weightedBySales = rows.some((row) => row.unitsSold > 0);
  const totals = sumMargins(
    rows
      .filter((row) => row.margin.flags.includes("no_rate") === false)
      .map((row) => ({ margin: row.margin, weight: weightedBySales ? row.unitsSold : 1 })),
  );
  return { clientId, settings, activeGridVersion, windowDays, rows, totals, weightedBySales };
}

// ---------------------------------------------------------------------------
// Per order (ECCANG) + global monthly summary
// ---------------------------------------------------------------------------

export type OrderMargin = {
  orderId: string;
  clientId: string;
  referenceNo: string;
  /** Display label: Shopify order name (#1042) when known, else the warehouse reference. */
  label: string;
  /** "eccang" = shipped parcel (real), "shopify" = estimate from a Shopify order. */
  basis: "eccang" | "shopify";
  shippedAt: string | null;
  billedWeightG: number | null;
  /** Products matched by SKU on the Shopify order lines. */
  lines: Array<{ sku: string; quantity: number; productId: string | null }>;
  /** Null when no product line could be matched (nothing to price). */
  margin: VoltshipMargin | null;
  /** "real" when the carrier cost comes from ECCANG fees, "estimated" from the grid, null unknown. */
  carrierSource: "real" | "estimated" | null;
  /** Fulfillment + tracking: ECCANG parcel, else what Shopify says; null when unknown. */
  shipping: (OrderShipping & { source: "eccang" | "shopify" }) | null;
};

export type ClientSummaryRow = {
  clientId: string;
  clientName: string;
  orders: number;
  /** Orders whose parcel could not be priced (no product match / no rate). */
  unpriced: number;
  totals: MarginTotals;
};

export type MarginSummary = {
  windowDays: number;
  since: string;
  settings: PricingSettings;
  activeGridVersion: string | null;
  ordersShipped: number;
  orders: OrderMargin[];
  totals: MarginTotals;
  byClient: ClientSummaryRow[];
};

type EccangOrderLite = {
  id: string;
  client_id: string;
  shop_id: string | null;
  shopify_order_id: string | null;
  reference_no: string;
  billed_weight_g: number | null;
  fee_json: unknown;
  shipped_at: string | null;
  /** External ECCANG orders (created by the client himself): lines come from ECCANG. */
  items_json?: Array<{ sku: string; quantity: number }> | null;
  label?: string | null;
  /** ECCANG parcel: tracking number + carrier. */
  tracking_no?: string | null;
  carrier_code?: string | null;
  /** Shopify order: fulfillment status + tracking from the order cache. */
  shipping?: OrderShipping | null;
};

/** Shipping state shown on the per-order margin: ECCANG parcel when there is one, else Shopify. */
function orderShippingOf(order: EccangOrderLite): OrderMargin["shipping"] {
  if (!order.reference_no.startsWith("shopify:")) {
    return {
      status: order.shipped_at ? "fulfilled" : "unfulfilled",
      trackingNumbers: order.tracking_no ? [order.tracking_no] : [],
      company: order.carrier_code ?? null,
      url: null,
      shippedAt: order.shipped_at,
      source: "eccang",
    };
  }
  return order.shipping ? { ...order.shipping, source: "shopify" } : null;
}

/**
 * Margin of one shipped parcel. The client side is priced with the live grid (same
 * engine as the quote) on the FIRST matched product's channel and primary market, at
 * the ECCANG billed weight when known. The carrier cost is real when the ECCANG fee
 * details carry a shipping line, otherwise estimated from the grid cell.
 */
function marginForOrder(
  order: EccangOrderLite,
  lines: Array<{ sku: string; quantity: number }>,
  productsBySku: Map<string, ProductRow>,
  factoryPrices: Map<string, number | null>,
  profile: ClientPricingProfile,
  cells: RateCell[],
  settings: PricingSettings,
  rules?: CarrierRules,
): OrderMargin {
  const matched = lines.map((line) => ({
    ...line,
    product: productsBySku.get(line.sku) ?? null,
  }));
  const priced = matched.filter(
    (line): line is typeof line & { product: ProductRow } =>
      line.product != null && line.quantity > 0 && line.product.client_price != null && line.product.weight_g != null,
  );
  const base = {
    orderId: order.id,
    clientId: order.client_id,
    referenceNo: order.reference_no,
    label: order.label ?? order.reference_no,
    basis: order.reference_no.startsWith("shopify:") ? ("shopify" as const) : ("eccang" as const),
    shippedAt: order.shipped_at,
    billedWeightG: order.billed_weight_g,
    lines: matched.map((line) => ({ sku: line.sku, quantity: line.quantity, productId: line.product?.id ?? null })),
    shipping: orderShippingOf(order),
  };
  if (priced.length === 0) return { ...base, margin: null, carrierSource: null };

  const lead = priced[0].product;
  const channel = (lead.shipping_channel ?? "standard") as ShippingChannel;
  const destination = getProductMarkets(lead)[0];
  // Each line: (unit weight + box) × qty; packaging once per parcel.
  const extrasOf = (product: ProductRow) => parcelExtras(product.quote_json, settings);
  const computedWeightG =
    priced.reduce(
      (sum, line) => sum + parcelWeightOf(line.product.weight_g ?? 0, line.quantity, { boxWeightG: extrasOf(line.product).boxWeightG }),
      0,
    ) + settings.packaging_weight_g;
  const parcelWeightG = order.billed_weight_g ?? computedWeightG;
  const units = priced.reduce((sum, line) => sum + line.quantity, 0);
  // Product side: client price × qty per line, commission on the product total. Boxes are
  // packaging billed at cost (no commission).
  const productTotal = priced.reduce((sum, line) => sum + Number(line.product.client_price) * line.quantity, 0);
  const boxTotal = priced.reduce((sum, line) => sum + extrasOf(line.product).boxPrice * line.quantity, 0);
  const commission = productTotal * (Math.max(0, profile.commissionPct) / 100);
  const cell = parcelWeightG > 0 ? findRateCell(cells, {
          weightG: parcelWeightG,
          channel,
          destination,
          batteryInternal: hasInternalBattery(lead.quote_json),
          ...carrierChoice(lead, destination, cells, rules),
        }) : null;
  const discount = Math.min(100, Math.max(0, profile.logisticsDiscountPct)) / 100;
  const computedClient = cell
    ? {
        // Boxes re-billed at cost sit with the product side (their RMB cost is in the factory cost).
        product: productTotal + boxTotal,
        commission,
        shipping: discountedShipping(cell.price, discount, cell.carrierCostRmb, settings.fx_rmb_per_eur),
        handling: handlingForQuantity(
          profile.handlingFee,
          units,
          profile.handlingGrows === false ? FLAT_HANDLING : handlingLadderFrom(settings),
        ),
      }
    : null;
  // One product in the parcel and a price promised for this quantity: the client pays it.
  const single = new Set(priced.map((line) => line.product.id)).size === 1;
  const announced = single
    ? announcedPriceFor(activeAnnouncedPrices(lead.quote_json), destination, units)
    : null;
  const client =
    computedClient && announced != null
      ? {
          ...computedClient,
          shipping: announced - computedClient.product - computedClient.commission - computedClient.handling,
        }
      : computedClient;
  let factoryCostRmb: number | null = 0;
  for (const line of priced) {
    const unit = factoryPrices.get(line.product.id) ?? null;
    if (unit == null) {
      factoryCostRmb = null;
      break;
    }
    factoryCostRmb += (unit + (productBox(line.product.quote_json)?.priceRmb ?? 0)) * line.quantity;
  }
  const realCarrier = extractCarrierCostRmb(order.fee_json);
  const margin = computeVoltshipMargin({
    quantity: units,
    client,
    factoryCostRmb,
    carrierCostRmb: realCarrier ?? cell?.carrierCostRmb ?? null,
    carrierCostSource: realCarrier != null ? "real" : cell?.carrierCostRmb != null ? "grid" : null,
    taxIncluded: cell?.taxIncluded !== false,
    settings,
  });
  return {
    ...base,
    margin,
    carrierSource: realCarrier != null ? "real" : cell?.carrierCostRmb != null ? "estimated" : null,
  };
}

// ---------------------------------------------------------------------------
// Shared order-pricing path (margin summary + weekly finances)
// ---------------------------------------------------------------------------

type OrderPricingContext = {
  settings: PricingSettings;
  activeGridVersion: string | null;
  cells: RateCell[];
  factoryPrices: Map<string, number | null>;
  productsByClient: Map<string, Map<string, ProductRow>>;
  profiles: Map<string, ClientPricingProfile>;
  rules: Map<string, CarrierRules>;
  names: Map<string, string>;
};

/** Everything needed to price the parcels of the given clients with the live grid. */
async function buildOrderPricingContext(clientIds: string[]): Promise<OrderPricingContext> {
  const admin = createAdminClient();
  const [settings, activeGridVersion, clientsResult] = await Promise.all([
    readPricingSettings(admin),
    getActiveGridVersion(),
    admin
      .from("clients")
      .select("id, name, pricing_tier, commission_pct, handling_fee, logistics_discount_pct, carrier_rules_json")
      .order("name"),
  ]);
  const relevant = clientIds.length > 0 ? await loadAdminProducts({ clientIds, includeArchived: true }) : [];
  const factoryPrices = await loadFactoryPrices(relevant.map((product) => product.id));
  const productsByClient = new Map<string, Map<string, ProductRow>>();
  const relevantSkus = await loadProductSkus(relevant);
  for (const product of relevant) {
    const map = productsByClient.get(product.client_id) ?? new Map<string, ProductRow>();
    for (const sku of relevantSkus.get(product.id) ?? []) {
      if (!map.has(sku)) map.set(sku, product);
    }
    productsByClient.set(product.client_id, map);
  }
  const markets = [...new Set(relevant.map((product) => getProductMarkets(product)[0]))];
  const channels = [...new Set(relevant.map((product) => product.shipping_channel).filter(Boolean))] as string[];
  const cells = activeGridVersion ? await loadInternalRateCells(activeGridVersion, markets, channels) : [];

  const profiles = new Map<string, ClientPricingProfile>();
  const rules = new Map<string, CarrierRules>();
  const names = new Map<string, string>();
  for (const client of clientsResult.data ?? []) {
    names.set(client.id, client.name);
    profiles.set(client.id, resolveClientPricing(client));
    rules.set(client.id, parseCarrierRules(client.carrier_rules_json));
  }
  return { settings, activeGridVersion, cells, factoryPrices, productsByClient, profiles, rules, names };
}

/** Shopify line items of the given orders, keyed by `${shop_id}:${shopify_order_id}`. */
async function loadOrderLines(clientIds: string[], shopifyIds: string[]) {
  const admin = createAdminClient();
  const lineMap = new Map<string, Array<{ sku: string; quantity: number }>>();
  if (clientIds.length === 0 || shopifyIds.length === 0) return lineMap;
  for (let i = 0; i < shopifyIds.length; i += 500) {
    const { data } = await admin
      .from("shopify_orders_cache")
      .select("shop_id, shopify_order_id, line_items_json")
      .in("client_id", clientIds)
      .in("shopify_order_id", shopifyIds.slice(i, i + 500));
    for (const row of data ?? []) {
      lineMap.set(`${row.shop_id}:${row.shopify_order_id}`, unpackOrderLines(row.line_items_json).lines);
    }
  }
  return lineMap;
}

function priceOrders(
  ctx: OrderPricingContext,
  orders: EccangOrderLite[],
  lineMap: Map<string, Array<{ sku: string; quantity: number }>>,
) {
  return orders.map((order) =>
    marginForOrder(
      order,
      lineMap.get(`${order.shop_id}:${order.shopify_order_id}`) ??
        (Array.isArray(order.items_json) ? order.items_json : []),
      ctx.productsByClient.get(order.client_id) ?? new Map(),
      ctx.factoryPrices,
      ctx.profiles.get(order.client_id) ?? { commissionPct: 0, handlingFee: 0, logisticsDiscountPct: 0 },
      ctx.cells,
      ctx.settings,
      ctx.rules.get(order.client_id),
    ),
  );
}

export type PricedOrderBatch = {
  settings: PricingSettings;
  activeGridVersion: string | null;
  /** Client id → name (all clients). */
  clientNames: Map<string, string>;
  orders: OrderMargin[];
};

/**
 * ECCANG parcels shipped in [sinceIso, untilIso) priced like the margin summary
 * (real carrier cost when the ECCANG fee carries it). `untilIso` omitted = open end.
 */
export async function loadShippedOrderMargins(range: { sinceIso: string; untilIso?: string }): Promise<PricedOrderBatch> {
  await assertVoltshipAdmin();
  const admin = createAdminClient();
  let query = admin
    .from("eccang_orders")
    .select(
      "id, client_id, shop_id, shopify_order_id, reference_no, billed_weight_g, fee_json, shipped_at, items_json, tracking_no, carrier_code",
    )
    .eq("status", "D")
    .gte("shipped_at", range.sinceIso);
  if (range.untilIso) query = query.lt("shipped_at", range.untilIso);
  const { data } = await query.order("shipped_at", { ascending: false }).limit(5000).returns<EccangOrderLite[]>();
  const orders = data ?? [];
  const clientIds = [...new Set(orders.map((order) => order.client_id))];
  const [ctx, lineMap] = await Promise.all([
    buildOrderPricingContext(clientIds),
    loadOrderLines(clientIds, [...new Set(orders.map((order) => order.shopify_order_id).filter(Boolean))] as string[]),
  ]);
  return {
    settings: ctx.settings,
    activeGridVersion: ctx.activeGridVersion,
    clientNames: ctx.names,
    orders: priceOrders(ctx, orders, lineMap),
  };
}

/**
 * Fallback when nothing shipped through ECCANG: Shopify orders PLACED between two
 * calendar dates (inclusive, `order_date`), priced at the computed weight with the
 * grid carrier cost. Every figure is an estimate (one parcel per order, no billed weight).
 */
export async function loadEstimatedShopifyOrderMargins(range: {
  fromDate: string;
  toDate: string;
}): Promise<PricedOrderBatch> {
  await assertVoltshipAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from("shopify_orders_cache")
    .select("id, client_id, shop_id, shopify_order_id, order_date, line_items_json")
    .eq("cancelled", false)
    .gte("order_date", range.fromDate)
    .lte("order_date", range.toDate)
    .order("order_date", { ascending: false })
    .limit(5000);
  const rows = data ?? [];
  const clientIds = [...new Set(rows.map((row) => row.client_id as string))];
  const ctx = await buildOrderPricingContext(clientIds);
  const lineMap = new Map<string, Array<{ sku: string; quantity: number }>>();
  const orders: EccangOrderLite[] = rows.map((row) => {
    const unpacked = unpackOrderLines(row.line_items_json);
    lineMap.set(`${row.shop_id}:${row.shopify_order_id}`, unpacked.lines);
    return {
      label: unpacked.name ?? `Shopify ${row.shopify_order_id}`,
      id: row.id,
      client_id: row.client_id,
      shop_id: row.shop_id,
      shopify_order_id: row.shopify_order_id,
      reference_no: `shopify:${row.shopify_order_id}`,
      billed_weight_g: null,
      fee_json: null,
      shipped_at: `${row.order_date}T12:00:00.000Z`,
      shipping: unpacked.shipping,
    };
  });
  return {
    settings: ctx.settings,
    activeGridVersion: ctx.activeGridVersion,
    clientNames: ctx.names,
    orders: priceOrders(ctx, orders, lineMap),
  };
}

export async function loadMarginSummary(windowDays = 30): Promise<MarginSummary> {
  const since = new Date();
  since.setDate(since.getDate() - (windowDays - 1));
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  const batch = await loadShippedOrderMargins({ sinceIso });
  const { settings, activeGridVersion, clientNames: names, orders: orderMargins } = batch;
  const clientIds = [...new Set(orderMargins.map((order) => order.clientId))];

  const byClient: ClientSummaryRow[] = clientIds
    .map((clientId) => {
      const own = orderMargins.filter((order) => order.clientId === clientId);
      const priced = own.filter((order) => order.margin != null);
      return {
        clientId,
        clientName: names.get(clientId) ?? clientId,
        orders: own.length,
        unpriced: own.length - priced.length,
        totals: sumMargins(priced.map((order) => ({ margin: order.margin as VoltshipMargin }))),
      };
    })
    .sort((a, b) => b.totals.margin - a.totals.margin);

  return {
    windowDays,
    since: sinceIso,
    settings,
    activeGridVersion,
    ordersShipped: orderMargins.length,
    orders: orderMargins,
    totals: sumMargins(
      orderMargins.filter((order) => order.margin != null).map((order) => ({ margin: order.margin as VoltshipMargin })),
    ),
    byClient,
  };
}

// ---------------------------------------------------------------------------
// Locked prices (« Prix annoncés ») under watch
// ---------------------------------------------------------------------------

export type AnnouncedPriceAlert = {
  productId: string;
  productTitle: string;
  clientId: string;
  clientName: string;
  market: string;
  quantity: number;
  /** Total per parcel promised to the client. */
  price: number;
  /** What the live palier rule would bill today (null when it cannot be computed). */
  rulePrice: number | null;
  /** Voltship margin per parcel at the locked price on the live grid. */
  margin: number | null;
  until: string | null;
  status: AnnouncedAlertStatus;
};

/**
 * Every locked price checked against the LIVE grid: when a carrier raises its prices (new
 * grid imported), the locked total does not move and the transport line absorbs the rise,
 * so the margin can fall under the alert threshold or below zero. Sorted worst first.
 */
export async function loadAnnouncedPriceAlerts(): Promise<{ threshold: number; rows: AnnouncedPriceAlert[] }> {
  await assertVoltshipAdmin();
  const admin = createAdminClient();
  const [products, settings, activeGridVersion] = await Promise.all([
    loadAdminProducts({}),
    readPricingSettings(admin),
    getActiveGridVersion(),
  ]);
  const locked = products.filter((product) => Object.keys(parseAnnouncedPrices(product.quote_json?.announced_prices)).length > 0);
  const threshold = settings.announced_margin_alert_eur;
  if (locked.length === 0) return { threshold, rows: [] };

  const clientIds = [...new Set(locked.map((product) => product.client_id))];
  const [factoryPrices, clientRows, profiles] = await Promise.all([
    loadFactoryPrices(locked.map((product) => product.id)),
    admin.from("clients").select("id, name, carrier_rules_json").in("id", clientIds),
    Promise.all(clientIds.map(async (id) => [id, await getClientPricingProfile(id)] as const)),
  ]);
  const clientNames = new Map((clientRows.data ?? []).map((row) => [row.id as string, String(row.name ?? "")]));
  const clientRules = new Map(
    (clientRows.data ?? []).map((row) => [row.id as string, parseCarrierRules(row.carrier_rules_json)]),
  );
  const profileOf = new Map(profiles);
  const markets = [
    ...new Set(locked.flatMap((product) => Object.keys(parseAnnouncedPrices(product.quote_json?.announced_prices)))),
  ];
  const channels = [...new Set(locked.map((product) => product.shipping_channel).filter(Boolean))] as string[];
  const cells = activeGridVersion ? await loadInternalRateCells(activeGridVersion, markets, channels) : [];
  const today = todayIso();

  const rows: AnnouncedPriceAlert[] = [];
  for (const product of locked) {
    const prices = parseAnnouncedPrices(product.quote_json?.announced_prices);
    const until = parseAnnouncedUntil(product.quote_json?.announced_until);
    const ctx: ProductContext = {
      product,
      factoryPriceRmb: factoryPrices.get(product.id) ?? null,
      profile: profileOf.get(product.client_id)!,
      cells,
      rules: clientRules.get(product.client_id),
    };
    // Same product without its locked prices = what the palier rule bills today.
    const ruleCtx: ProductContext = {
      ...ctx,
      product: { ...product, quote_json: { ...(product.quote_json ?? {}), announced_prices: {} } },
    };
    for (const [market, byQty] of Object.entries(prices)) {
      for (const [qty, price] of Object.entries(byQty)) {
        const quantity = Number(qty);
        const atLocked = marginForParcel(ctx, market, quantity, settings);
        const atRule = marginForParcel(ruleCtx, market, quantity, settings);
        const priced = !atLocked.flags.includes("no_rate");
        const margin = priced ? atLocked.margin.total : null;
        rows.push({
          productId: product.id,
          productTitle: product.title,
          clientId: product.client_id,
          clientName: clientNames.get(product.client_id) ?? "",
          market,
          quantity,
          price,
          rulePrice: atRule.flags.includes("no_rate") ? null : atRule.clientPays.total,
          margin,
          until: until[market] ?? null,
          status: classifyAnnouncedPrice({ until: until[market] ?? null, today, margin, threshold }),
        });
      }
    }
  }
  const order: AnnouncedAlertStatus[] = ["loss", "low_margin", "expired", "expiring", "no_data", "ok"];
  rows.sort(
    (a, b) =>
      order.indexOf(a.status) - order.indexOf(b.status) ||
      (a.margin ?? 0) - (b.margin ?? 0) ||
      a.productTitle.localeCompare(b.productTitle) ||
      a.market.localeCompare(b.market) ||
      a.quantity - b.quantity,
  );
  return { threshold, rows };
}
