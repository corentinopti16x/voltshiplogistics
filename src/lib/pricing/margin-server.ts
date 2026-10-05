import "server-only";

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
  calculateCogs,
  findRateCell,
  parseParcelDimensions,
  type RateCell,
  type ShippingChannel,
} from "@/lib/domain/pricing";
import {
  getActiveGridVersion,
  getClientPricingProfile,
  getProductMarkets,
  type ClientPricingProfile,
} from "@/lib/pricing/server";
import { readPricingSettings, type PricingSettings } from "@/lib/pricing/settings";
import { CLIENT_PRODUCT_SELECT, serializeClientProduct } from "@/lib/products/visibility";
import type { ProductRow } from "@/lib/products/types";
import { unpackOrderLines } from "@/lib/shopify/order-cache";
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
  const { data } = await admin
    .from("rate_grid_cells")
    .select(
      "grid_version, carrier, destination, channel, weight_min_g, weight_max_g, price, delivery_range, line_name, carrier_cost_rmb, tax_included, ioss_required",
    )
    .eq("grid_version", gridVersion)
    .in("destination", destinations)
    .in("channel", channels);
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
};

/** Client-facing breakdown + the matching cell's internal cost → margin, for one parcel. */
function marginForParcel(
  ctx: ProductContext,
  destination: string,
  quantity: number,
  settings: PricingSettings,
): VoltshipMargin {
  const { product, profile, cells } = ctx;
  const ready = product.client_price != null && product.weight_g != null && !!product.shipping_channel;
  const channel = (product.shipping_channel ?? "standard") as ShippingChannel;
  const unitWeightG = product.weight_g ?? 0;
  const dimensionsCm = parseParcelDimensions(product.quote_json);
  // Same engine as the client quote: product × n, commission on product, one parcel, handling once.
  const breakdown = ready
    ? calculateCogs({
        clientPrice: Number(product.client_price),
        weightG: unitWeightG,
        channel,
        destination,
        cells,
        quantity,
        dimensionsCm,
        volumetricDivisors: settings.volumetric_divisors,
        ...profile,
      })
    : null;
  // Same cell selection as calculateCogs (findRateCell on the billed parcel weight) to read
  // the internal carrier cost of the cell the client price came from.
  const parcelWeightG = unitWeightG * quantity;
  const cell =
    breakdown && parcelWeightG > 0
      ? findRateCell(cells, {
          weightG: parcelWeightG,
          quantity,
          dimensionsCm,
          volumetricDivisors: settings.volumetric_divisors,
          channel,
          destination,
        })
      : null;
  return computeVoltshipMargin({
    quantity,
    client: breakdown,
    factoryCostRmb: ctx.factoryPriceRmb == null ? null : ctx.factoryPriceRmb * quantity,
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
  const [settings, activeGridVersion, profile, factoryPrices, clientRow] = await Promise.all([
    readPricingSettings(admin),
    getActiveGridVersion(),
    getClientPricingProfile(product.client_id),
    loadFactoryPrices([product.id]),
    admin.from("clients").select("name").eq("id", product.client_id).maybeSingle(),
  ]);
  const markets = getProductMarkets(product);
  const cells =
    activeGridVersion && product.shipping_channel
      ? await loadInternalRateCells(activeGridVersion, markets, [product.shipping_channel])
      : [];
  const factoryPriceRmb = factoryPrices.get(product.id) ?? null;
  const ctx: ProductContext = { product, factoryPriceRmb, profile, cells };
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
  const [products, settings, activeGridVersion, profile, unitsSold] = await Promise.all([
    loadAdminProducts({ clientId }),
    readPricingSettings(admin),
    getActiveGridVersion(),
    getClientPricingProfile(clientId),
    loadUnitsSold(clientId, windowDays),
  ]);
  const factoryPrices = await loadFactoryPrices(products.map((product) => product.id));
  const markets = [...new Set(products.map((product) => getProductMarkets(product)[0]))];
  const channels = [...new Set(products.map((product) => product.shipping_channel).filter(Boolean))] as string[];
  const cells = activeGridVersion ? await loadInternalRateCells(activeGridVersion, markets, channels) : [];

  const rows: ClientMarginRow[] = products.map((product) => {
    const factoryPriceRmb = factoryPrices.get(product.id) ?? null;
    const market = getProductMarkets(product)[0];
    const units = product.sku ? unitsSold.get(product.sku) ?? 0 : 0;
    return {
      product,
      market,
      factoryPriceRmb,
      unitsSold: units,
      margin: marginForParcel({ product, factoryPriceRmb, profile, cells }, market, 1, settings),
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
  shippedAt: string | null;
  billedWeightG: number | null;
  /** Products matched by SKU on the Shopify order lines. */
  lines: Array<{ sku: string; quantity: number; productId: string | null }>;
  /** Null when no product line could be matched (nothing to price). */
  margin: VoltshipMargin | null;
  /** "real" when the carrier cost comes from ECCANG fees, "estimated" from the grid, null unknown. */
  carrierSource: "real" | "estimated" | null;
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
};

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
    shippedAt: order.shipped_at,
    billedWeightG: order.billed_weight_g,
    lines: matched.map((line) => ({ sku: line.sku, quantity: line.quantity, productId: line.product?.id ?? null })),
  };
  if (priced.length === 0) return { ...base, margin: null, carrierSource: null };

  const lead = priced[0].product;
  const channel = (lead.shipping_channel ?? "standard") as ShippingChannel;
  const destination = getProductMarkets(lead)[0];
  const computedWeightG = priced.reduce((sum, line) => sum + (line.product.weight_g ?? 0) * line.quantity, 0);
  const parcelWeightG = order.billed_weight_g ?? computedWeightG;
  const units = priced.reduce((sum, line) => sum + line.quantity, 0);
  // Product side: client price × qty per line, commission on the product total.
  const productTotal = priced.reduce((sum, line) => sum + Number(line.product.client_price) * line.quantity, 0);
  const commission = productTotal * (Math.max(0, profile.commissionPct) / 100);
  const cell = parcelWeightG > 0 ? findRateCell(cells, { weightG: parcelWeightG, channel, destination }) : null;
  const discount = Math.min(100, Math.max(0, profile.logisticsDiscountPct)) / 100;
  const client = cell
    ? {
        product: productTotal,
        commission,
        shipping: cell.price - cell.price * discount,
        handling: Math.max(0, profile.handlingFee),
      }
    : null;
  let factoryCostRmb: number | null = 0;
  for (const line of priced) {
    const unit = factoryPrices.get(line.product.id) ?? null;
    if (unit == null) {
      factoryCostRmb = null;
      break;
    }
    factoryCostRmb += unit * line.quantity;
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
  names: Map<string, string>;
};

/** Everything needed to price the parcels of the given clients with the live grid. */
async function buildOrderPricingContext(clientIds: string[]): Promise<OrderPricingContext> {
  const admin = createAdminClient();
  const [settings, activeGridVersion, clientsResult] = await Promise.all([
    readPricingSettings(admin),
    getActiveGridVersion(),
    admin.from("clients").select("id, name, commission_pct, handling_fee, logistics_discount_pct").order("name"),
  ]);
  const relevant = clientIds.length > 0 ? await loadAdminProducts({ clientIds, includeArchived: true }) : [];
  const factoryPrices = await loadFactoryPrices(relevant.map((product) => product.id));
  const productsByClient = new Map<string, Map<string, ProductRow>>();
  for (const product of relevant) {
    if (!product.sku) continue;
    const map = productsByClient.get(product.client_id) ?? new Map<string, ProductRow>();
    if (!map.has(product.sku)) map.set(product.sku, product);
    productsByClient.set(product.client_id, map);
  }
  const markets = [...new Set(relevant.map((product) => getProductMarkets(product)[0]))];
  const channels = [...new Set(relevant.map((product) => product.shipping_channel).filter(Boolean))] as string[];
  const cells = activeGridVersion ? await loadInternalRateCells(activeGridVersion, markets, channels) : [];

  const profiles = new Map<string, ClientPricingProfile>();
  const names = new Map<string, string>();
  for (const client of clientsResult.data ?? []) {
    names.set(client.id, client.name);
    profiles.set(client.id, {
      commissionPct: Number(client.commission_pct) || 0,
      handlingFee: Number(client.handling_fee) || 0,
      logisticsDiscountPct: Number(client.logistics_discount_pct) || 0,
    });
  }
  return { settings, activeGridVersion, cells, factoryPrices, productsByClient, profiles, names };
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
      lineMap.get(`${order.shop_id}:${order.shopify_order_id}`) ?? [],
      ctx.productsByClient.get(order.client_id) ?? new Map(),
      ctx.factoryPrices,
      ctx.profiles.get(order.client_id) ?? { commissionPct: 0, handlingFee: 0, logisticsDiscountPct: 0 },
      ctx.cells,
      ctx.settings,
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
    .select("id, client_id, shop_id, shopify_order_id, reference_no, billed_weight_g, fee_json, shipped_at")
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
    lineMap.set(`${row.shop_id}:${row.shopify_order_id}`, unpackOrderLines(row.line_items_json).lines);
    return {
      id: row.id,
      client_id: row.client_id,
      shop_id: row.shop_id,
      shopify_order_id: row.shopify_order_id,
      reference_no: `shopify:${row.shopify_order_id}`,
      billed_weight_g: null,
      fee_json: null,
      shipped_at: `${row.order_date}T12:00:00.000Z`,
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
