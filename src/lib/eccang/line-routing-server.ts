import "server-only";

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowedLinesFromRules, parseCarrierPreferences, type CarrierRules } from "@/lib/domain/carrier-rules";
import {
  buildCoverageIndex,
  checkParcelLine,
  rankLines,
  type CoverageIndex,
  type RouteInput,
  type ZipCoverage,
  type ZipCoverageMode,
} from "@/lib/domain/line-routing";
import {
  autoCarriersFor,
  hasInternalBattery,
  lineKey,
  normalizeDestination,
  parseParcelDimensions,
  type CarrierLineRef,
  type PackagingStep,
  type RateCell,
  type ShippingChannel,
  type VolumetricDivisors,
} from "@/lib/domain/pricing";
import { getActiveGridVersion, loadCarrierRules, loadRateCellsFor } from "@/lib/pricing/server";
import { readPricingSettings } from "@/lib/pricing/settings";
import { packPieces, productBox, productPackagingG } from "@/lib/products/extras";
import { parseShippingMethodMap, type ShippingMethodMap } from "@/lib/eccang/mapping";
import {
  exactShippingMethod,
  lineForShippingMethod,
  parcelFactsFromRow,
  parcelFromItems,
  type OrderParcelFacts,
  type ParcelEstimate,
  type ParcelProduct,
} from "@/lib/eccang/line-routing";

function isMissingTable(error: { code?: string; message?: string } | null) {
  return Boolean(
    error && (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "")),
  );
}

// --- Postcode lists ----------------------------------------------------------------------

type CoverageRow = {
  id: string;
  destination: string;
  carrier: string;
  line_name: string;
  mode: string;
  zips: string[] | null;
  note: string | null;
  updated_at: string;
};

export type ZipCoverageSummary = {
  id: string;
  destination: string;
  carrier: string;
  lineName: string | null;
  mode: ZipCoverageMode;
  count: number;
  sample: string[];
  note: string | null;
  updatedAt: string;
};

/** Every postcode list, plus the latest change (part of the check fingerprint). */
export async function loadZipCoverage(): Promise<{ coverages: ZipCoverage[]; version: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("carrier_zip_coverage")
    .select("destination, carrier, line_name, mode, zips, updated_at");
  if (isMissingTable(error)) return { coverages: [], version: "none" }; // Migration 00023 not applied yet.
  if (error) throw error;
  const rows = (data ?? []) as CoverageRow[];
  return {
    version: rows.length ? `${rows.length}@${rows.map((row) => row.updated_at).sort().at(-1)}` : "none",
    coverages: rows.map((row) => ({
      destination: row.destination,
      carrier: row.carrier,
      lineName: row.line_name || null,
      mode: row.mode === "except" ? "except" : "only",
      zips: row.zips ?? [],
    })),
  };
}

export async function listZipCoverage(): Promise<{ rows: ZipCoverageSummary[]; migrated: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("carrier_zip_coverage")
    .select("id, destination, carrier, line_name, mode, zips, note, updated_at")
    .order("destination")
    .order("carrier");
  if (isMissingTable(error)) return { rows: [], migrated: false };
  if (error) throw error;
  return {
    migrated: true,
    rows: ((data ?? []) as CoverageRow[]).map((row) => ({
      id: row.id,
      destination: row.destination,
      carrier: row.carrier,
      lineName: row.line_name || null,
      mode: row.mode === "except" ? "except" : "only",
      count: row.zips?.length ?? 0,
      sample: (row.zips ?? []).slice(0, 6),
      note: row.note,
      updatedAt: row.updated_at,
    })),
  };
}

export async function saveZipCoverage(input: ZipCoverage & { note?: string | null; userId?: string | null }) {
  const admin = createAdminClient();
  const { error } = await admin.from("carrier_zip_coverage").upsert(
    {
      destination: normalizeDestination(input.destination),
      carrier: input.carrier.trim(),
      line_name: input.lineName?.trim() ?? "",
      mode: input.mode,
      zips: input.zips,
      note: input.note?.trim() || null,
      updated_by: input.userId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "destination,carrier,line_name" },
  );
  if (error) throw error;
  forgetRoutingCache();
}

export async function deleteZipCoverage(id: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("carrier_zip_coverage").delete().eq("id", id);
  if (error) throw error;
  forgetRoutingCache();
}

export type GridLine = { destination: string; carrier: string; lineName: string | null };

/** Every (market, carrier, line) of the live grid — choices of the postcode-list form. */
export async function listGridLines(): Promise<GridLine[]> {
  const gridVersion = await getActiveGridVersion();
  if (!gridVersion) return [];
  const admin = createAdminClient();
  const lines = new Map<string, GridLine>();
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await admin
      .from("rate_grid_cells")
      .select("destination, carrier, line_name")
      .eq("grid_version", gridVersion)
      // Every line ships small parcels: its first brackets are enough to list it.
      .lte("weight_min_g", 1000)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ destination: string; carrier: string; line_name: string | null }>) {
      const destination = row.destination.trim().toUpperCase();
      const key = `${destination}|${lineKey(row.carrier, row.line_name || null)}`;
      if (!lines.has(key)) lines.set(key, { destination, carrier: row.carrier, lineName: row.line_name || null });
    }
    if (!data || data.length < 1000) break;
  }
  return [...lines.values()].sort(
    (a, b) =>
      a.destination.localeCompare(b.destination) ||
      a.carrier.localeCompare(b.carrier) ||
      (a.lineName ?? "").localeCompare(b.lineName ?? ""),
  );
}

// --- Routing context (cached a few minutes per server instance) ---------------------------

export type RoutingContext = {
  gridVersion: string;
  /** Grid + postcode lists + method map: a change re-checks every order. */
  version: string;
  fx: number;
  autoCarriers: Record<string, string[]>;
  ladder: PackagingStep[];
  divisors: VolumetricDivisors;
  coverage: CoverageIndex;
  methodMap: ShippingMethodMap;
  cellsFor: (destination: string, channel: string) => Promise<RateCell[]>;
};

const CACHE_MS = 5 * 60_000;
let contextCache: { at: number; value: Promise<RoutingContext | null> } | null = null;
const productCache = new Map<string, { at: number; value: Promise<Map<string, ParcelProduct>> }>();

function forgetRoutingCache() {
  contextCache = null;
  productCache.clear();
}

/** pricing_meta "eccang_shipping_methods" (same key as sync.ts, read here to avoid an import cycle). */
async function loadShippingMethodMap(): Promise<ShippingMethodMap> {
  const admin = createAdminClient();
  const { data } = await admin.from("pricing_meta").select("value").eq("key", "eccang_shipping_methods").maybeSingle();
  return parseShippingMethodMap(data?.value);
}

async function buildRoutingContext(): Promise<RoutingContext | null> {
  const admin = createAdminClient();
  const gridVersion = await getActiveGridVersion();
  if (!gridVersion) return null;
  const [settings, coverage, methodMap] = await Promise.all([
    readPricingSettings(admin),
    loadZipCoverage(),
    loadShippingMethodMap(),
  ]);
  const cells = new Map<string, Promise<RateCell[]>>();
  return {
    gridVersion,
    version: `${gridVersion}|${coverage.version}|${JSON.stringify(methodMap)}|${JSON.stringify(settings.auto_carriers)}`,
    fx: settings.fx_rmb_per_eur,
    autoCarriers: settings.auto_carriers,
    ladder: settings.packaging_ladder,
    divisors: settings.volumetric_divisors,
    coverage: buildCoverageIndex(coverage.coverages),
    methodMap,
    cellsFor(destination, channel) {
      const key = `${destination}|${channel}`;
      let loaded = cells.get(key);
      if (!loaded) {
        loaded = loadRateCellsFor(gridVersion, [destination], [channel]);
        loaded.catch(() => cells.delete(key));
        cells.set(key, loaded);
      }
      return loaded;
    },
  };
}

/** Live grid, pricing settings, postcode lists and ECCANG method map (cells loaded on demand). */
export async function loadRoutingContext(options: { fresh?: boolean } = {}): Promise<RoutingContext | null> {
  if (options.fresh || !contextCache || Date.now() - contextCache.at > CACHE_MS) {
    const value = buildRoutingContext();
    contextCache = { at: Date.now(), value };
    value.catch(() => (contextCache = null));
  }
  return contextCache.value;
}

type ProductLookupRow = {
  sku: string | null;
  weight_g: number | null;
  shipping_channel: string | null;
  quote_json: Record<string, unknown> | null;
};

async function buildParcelProducts(clientId: string): Promise<Map<string, ParcelProduct>> {
  const admin = createAdminClient();
  const rows: ProductLookupRow[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await admin
      .from("products_cache")
      .select("sku, weight_g, shipping_channel, quote_json")
      .eq("client_id", clientId)
      .not("sku", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as ProductLookupRow[]));
    if (!data || data.length < 1000) break;
  }
  const products = new Map<string, ParcelProduct>();
  const put = (sku: string, product: ParcelProduct) => {
    for (const key of new Set([sku, sku.toUpperCase()])) {
      const known = products.get(key);
      // Duplicate sheets of one SKU: keep the one that has a weight.
      if (!known || (!(Number(known.weightG) > 0) && Number(product.weightG) > 0)) products.set(key, product);
    }
  };
  for (const row of rows) {
    const sku = row.sku?.trim();
    if (!sku) continue;
    put(sku, {
      weightG: row.weight_g,
      pieces: packPieces(row.quote_json),
      channel: row.shipping_channel,
      batteryInternal: hasInternalBattery(row.quote_json),
      boxWeightG: productBox(row.quote_json)?.weightG ?? 0,
      packagingWeightG: productPackagingG(row.quote_json),
      dimensionsCm: parseParcelDimensions(row.quote_json),
      carrierPrefs: parseCarrierPreferences(row.quote_json),
    });
  }
  // ECCANG lines carry the warehouse SKU (sku_maps.eccang_sku) when Voltship set one.
  const { data: maps } = await admin
    .from("sku_maps")
    .select("shopify_sku, eccang_sku")
    .eq("client_id", clientId)
    .not("eccang_sku", "is", null)
    .limit(1000);
  for (const map of (maps ?? []) as Array<{ shopify_sku: string | null; eccang_sku: string | null }>) {
    const warehouse = map.eccang_sku?.trim();
    const product = map.shopify_sku ? products.get(map.shopify_sku.trim()) : undefined;
    if (warehouse && product && !products.has(warehouse)) put(warehouse, product);
  }
  return products;
}

/** Weight / channel / battery / packaging / line choice of the client's products, by SKU and warehouse SKU. */
export async function loadParcelProducts(clientId: string): Promise<Map<string, ParcelProduct>> {
  const cached = productCache.get(clientId);
  if (cached && Date.now() - cached.at <= CACHE_MS) return cached.value;
  const value = buildParcelProducts(clientId);
  productCache.set(clientId, { at: Date.now(), value });
  value.catch(() => productCache.delete(clientId));
  return value;
}

export type PlannedParcel = {
  destination: string;
  parcel: ParcelEstimate;
  input: RouteInput;
  cells: RateCell[];
  autoCarriers: string[] | null;
};

/**
 * Routing input of a parcel: destination, postcode, weight (billed when asked and known),
 * channel, allowed lines, the forced / chosen line. Null when a product of the parcel is
 * unknown (its channel and weight would be guessed) or nothing can be weighed.
 */
export async function planParcel(
  ctx: RoutingContext,
  rules: CarrierRules,
  facts: Pick<OrderParcelFacts, "country" | "zip" | "billedWeightG" | "items">,
  products: ReadonlyMap<string, ParcelProduct>,
  options: { preferBilledWeight: boolean },
): Promise<PlannedParcel | null> {
  if (!facts.country || facts.items.length === 0) return null;
  const destination = normalizeDestination(facts.country);
  const parcel = parcelFromItems(facts.items, products, ctx.ladder);
  if (parcel.missing.length > 0) return null;
  const weightG = options.preferBilledWeight && facts.billedWeightG ? facts.billedWeightG : parcel.weightG;
  if (!(weightG > 0)) return null;
  const channel: ShippingChannel = parcel.channel ?? "standard";
  const cells = await ctx.cellsFor(destination, channel);
  const lead = parcel.lead ? (products.get(parcel.lead) ?? products.get(parcel.lead.toUpperCase())) : undefined;
  const single = parcel.singleUnits != null ? lead : undefined;
  const preferredLine: CarrierLineRef | null = rules.forced[destination] ?? lead?.carrierPrefs?.[destination] ?? null;
  const input: RouteInput = {
    destination,
    channel,
    weightG,
    // Volumetric weight only for a single-product parcel (as the COGS engine does).
    quantity: single ? parcel.singleUnits : 1,
    dimensionsCm: single?.dimensionsCm ?? null,
    volumetricDivisors: ctx.divisors,
    batteryInternal: parcel.batteryInternal,
    allowedLines: allowedLinesFromRules(cells, rules),
    zip: facts.zip,
    fxRmbPerEur: ctx.fx,
    preferredLine: preferredLine && rules.blocked.includes(lineKey(preferredLine.carrier, preferredLine.lineName)) ? null : preferredLine,
  };
  return { destination, parcel, input, cells, autoCarriers: autoCarriersFor(ctx.autoCarriers, destination) };
}

/**
 * Line of a Shopify order the app pushes to ECCANG (ECCANG_PUSH_ORDERS=1): cheapest line
 * covering the postcode for the whole parcel (or the forced / chosen line). `items` are
 * units SOLD (converted to pieces here). Null when the routing cannot decide or the line
 * has no ECCANG method of its own — the caller then falls back to the product's line.
 */
export async function routeShopifyOrder(
  clientId: string,
  address: { country_code?: string | null; zip?: string | null } | null | undefined,
  items: Array<{ product_sku: string; quantity: number }>,
): Promise<{ code: string; carrier: string; lineName: string | null } | null> {
  const ctx = await loadRoutingContext();
  if (!ctx) return null;
  const [products, rules] = await Promise.all([loadParcelProducts(clientId), loadCarrierRules(clientId)]);
  const pieces = items.map((item) => ({
    sku: item.product_sku,
    quantity: item.quantity * (products.get(item.product_sku)?.pieces ?? 1),
  }));
  const plan = await planParcel(
    ctx,
    rules,
    { country: address?.country_code ?? null, zip: address?.zip ?? null, billedWeightG: null, items: pieces },
    products,
    { preferBilledWeight: false },
  );
  if (!plan) return null;
  const { best } = rankLines(plan.cells, plan.input, ctx.coverage, plan.autoCarriers);
  const code = exactShippingMethod(ctx.methodMap, best);
  return best && code ? { code, carrier: best.carrier, lineName: best.lineName } : null;
}

// --- Planned vs actual (cron) ----------------------------------------------------------------

type OrderRow = {
  id: string;
  reference_no: string;
  status: string;
  tracking_no: string | null;
  shipping_method: string | null;
  billed_weight_g: number | null;
  items_json: unknown;
  last_payload: unknown;
};

export type LineCheckSummary = { checked: number; moreExpensive: number; extraRmb: number; unknownLine: number };

const EMPTY_SUMMARY: LineCheckSummary = { checked: 0, moreExpensive: 0, extraRmb: 0, unknownLine: 0 };

/** What the check depends on: a row is re-checked only when one of these changed. */
function fingerprint(ctx: RoutingContext, row: OrderRow, facts: OrderParcelFacts) {
  return createHash("sha1")
    .update(
      JSON.stringify([
        ctx.version,
        row.status,
        row.tracking_no,
        facts.shippingMethod,
        facts.billedWeightG,
        facts.country,
        facts.zip,
        facts.items,
      ]),
    )
    .digest("base64url");
}

/**
 * Every ECCANG order of the client changed in the last `days`: line Voltship plans vs the
 * line the parcel is on in ECCANG, both priced at the carrier cost (RMB) →
 * eccang_order_line_checks (internal). Orders whose data, the grid, the postcode lists and
 * the method map did not change since their last check are skipped (`force` re-checks all).
 * Read-only on ECCANG: a parcel still without label on a dearer line is flagged "open" so
 * the team can switch it before packing.
 */
export async function checkOrderLines(
  clientId: string,
  options: { days?: number; context?: RoutingContext | null; force?: boolean } = {},
): Promise<LineCheckSummary> {
  const admin = createAdminClient();
  const ctx = options.context === undefined ? await loadRoutingContext() : options.context;
  if (!ctx) return EMPTY_SUMMARY;
  const since = new Date(Date.now() - (options.days ?? 3) * 86400000).toISOString();

  const rows: OrderRow[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await admin
      .from("eccang_orders")
      .select("id, reference_no, status, tracking_no, shipping_method, billed_weight_g, items_json, last_payload")
      .eq("client_id", clientId)
      .gte("updated_at", since)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as OrderRow[]));
    if (!data || data.length < 1000) break;
  }
  if (rows.length === 0) return EMPTY_SUMMARY;

  const previous = new Map<string, string | null>();
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await admin
      .from("eccang_order_line_checks")
      .select("order_id, fingerprint")
      .in("order_id", rows.slice(i, i + 200).map((row) => row.id));
    if (isMissingTable(error)) return EMPTY_SUMMARY; // Migration 00023 not applied yet.
    if (error) throw error;
    for (const check of data ?? []) previous.set(check.order_id as string, (check.fingerprint as string | null) ?? null);
  }

  const [products, rules] = await Promise.all([loadParcelProducts(clientId), loadCarrierRules(clientId)]);
  const summary: LineCheckSummary = { ...EMPTY_SUMMARY };
  const now = new Date().toISOString();
  let batch: Record<string, unknown>[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const { error } = await admin.from("eccang_order_line_checks").upsert(batch, { onConflict: "order_id" });
    batch = [];
    if (error) throw error;
  };

  for (const row of rows) {
    const facts = parcelFactsFromRow(row);
    const print = fingerprint(ctx, row, facts);
    if (!options.force && previous.get(row.id) === print) continue;
    const shipped = row.status === "D";
    const plan = await planParcel(ctx, rules, facts, products, { preferBilledWeight: shipped });
    const base = {
      order_id: row.id,
      client_id: clientId,
      reference_no: row.reference_no,
      order_status: row.status,
      has_tracking: Boolean(row.tracking_no),
      destination: plan?.destination ?? facts.country,
      zip: facts.zip,
      weight_g: plan ? Math.round(plan.input.weightG) : facts.billedWeightG,
      shipping_method: facts.shippingMethod,
      fingerprint: print,
      checked_at: now,
    };
    if (!plan) {
      batch.push({ ...base, status: "no_data", planned_line: null, planned_cost_rmb: null, actual_line: null, actual_cost_rmb: null, extra_rmb: null });
    } else {
      const actualLine = lineForShippingMethod(ctx.methodMap, facts.shippingMethod);
      const check = checkParcelLine(plan.cells, plan.input, ctx.coverage, plan.autoCarriers, actualLine);
      summary.checked += 1;
      if (check.status === "more_expensive") {
        summary.moreExpensive += 1;
        summary.extraRmb += check.extraRmb ?? 0;
      }
      if (check.status === "unknown_line") summary.unknownLine += 1;
      batch.push({
        ...base,
        status: check.status,
        planned_line: check.planned ? lineKey(check.planned.carrier, check.planned.lineName) : null,
        planned_cost_rmb: check.planned?.costRmb ?? null,
        actual_line: check.actual ? lineKey(check.actual.carrier, check.actual.lineName) : null,
        actual_cost_rmb: check.actual?.costRmb ?? null,
        extra_rmb: check.extraRmb,
      });
    }
    if (batch.length >= 200) await flush();
  }
  await flush();
  summary.extraRmb = Math.round(summary.extraRmb * 100) / 100;
  return summary;
}

// --- Admin view --------------------------------------------------------------------------------

export type LineCheckRow = {
  orderId: string;
  clientName: string | null;
  referenceNo: string;
  externalRef: string | null;
  destination: string | null;
  zip: string | null;
  weightG: number | null;
  shippingMethod: string | null;
  plannedLine: string | null;
  plannedMethod: string | null;
  plannedCostRmb: number | null;
  actualLine: string | null;
  actualCostRmb: number | null;
  extraRmb: number | null;
  status: string;
  /** Still in ECCANG without label: the line can still be switched before packing. */
  open: boolean;
  checkedAt: string;
};

export type LineCheckOverview = {
  migrated: boolean;
  days: number;
  checked: number;
  ok: number;
  moreExpensive: number;
  /** Dearer parcels still without label (can be switched). */
  moreExpensiveOpen: number;
  extraRmb: number;
  cheaper: number;
  unknownLine: number;
  noPlan: number;
  /** ECCANG shipping methods not mapped to a grid line, with how many orders used them. */
  unmappedMethods: Array<{ method: string; orders: number }>;
  rows: LineCheckRow[];
};

/** Last `days` of checks for the admin "Lignes" page (open dearer parcels, then biggest extra cost). */
export async function lineCheckOverview(days = 7, limit = 200): Promise<LineCheckOverview> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const overview: LineCheckOverview = {
    migrated: true,
    days,
    checked: 0,
    ok: 0,
    moreExpensive: 0,
    moreExpensiveOpen: 0,
    extraRmb: 0,
    cheaper: 0,
    unknownLine: 0,
    noPlan: 0,
    unmappedMethods: [],
    rows: [],
  };
  type CheckRow = {
    order_id: string;
    client_id: string;
    reference_no: string;
    order_status: string | null;
    has_tracking: boolean | null;
    destination: string | null;
    zip: string | null;
    weight_g: number | null;
    shipping_method: string | null;
    planned_line: string | null;
    planned_cost_rmb: number | null;
    actual_line: string | null;
    actual_cost_rmb: number | null;
    extra_rmb: number | null;
    status: string;
    checked_at: string;
  };
  const all: CheckRow[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await admin
      .from("eccang_order_line_checks")
      .select(
        "order_id, client_id, reference_no, order_status, has_tracking, destination, zip, weight_g, shipping_method, planned_line, planned_cost_rmb, actual_line, actual_cost_rmb, extra_rmb, status, checked_at",
      )
      .gte("checked_at", since)
      .order("order_id")
      .range(from, from + 999);
    if (isMissingTable(error)) return { ...overview, migrated: false };
    if (error) throw error;
    all.push(...((data ?? []) as CheckRow[]));
    if (!data || data.length < 1000) break;
  }
  const isOpen = (row: CheckRow) => !row.has_tracking && row.order_status !== "D" && row.order_status !== "X";
  const unmapped = new Map<string, number>();
  for (const row of all) {
    overview.checked += 1;
    if (row.status === "ok") overview.ok += 1;
    if (row.status === "more_expensive") {
      overview.moreExpensive += 1;
      overview.extraRmb += Number(row.extra_rmb) || 0;
      if (isOpen(row)) overview.moreExpensiveOpen += 1;
    }
    if (row.status === "cheaper") overview.cheaper += 1;
    if (row.status === "no_plan" || row.status === "no_data") overview.noPlan += 1;
    if (row.status === "unknown_line") {
      overview.unknownLine += 1;
      const method = row.shipping_method?.trim() || "—";
      unmapped.set(method, (unmapped.get(method) ?? 0) + 1);
    }
  }
  overview.extraRmb = Math.round(overview.extraRmb * 100) / 100;
  overview.unmappedMethods = [...unmapped.entries()]
    .map(([method, orders]) => ({ method, orders }))
    .sort((a, b) => b.orders - a.orders);

  const flagged = all
    .filter((row) => row.status !== "ok")
    .sort(
      (a, b) =>
        Number(isOpen(b) && b.status === "more_expensive") - Number(isOpen(a) && a.status === "more_expensive") ||
        (Number(b.extra_rmb) || 0) - (Number(a.extra_rmb) || 0) ||
        b.checked_at.localeCompare(a.checked_at),
    )
    .slice(0, limit);
  const orderIds = flagged.map((row) => row.order_id);
  const clientIds = [...new Set(flagged.map((row) => row.client_id))];
  const [orders, clients, methodMap] = await Promise.all([
    orderIds.length
      ? admin.from("eccang_orders").select("id, external_ref").in("id", orderIds)
      : Promise.resolve({ data: [] as Array<{ id: string; external_ref: string | null }> }),
    clientIds.length
      ? admin.from("clients").select("id, name").in("id", clientIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string | null }> }),
    loadShippingMethodMap(),
  ]);
  const refs = new Map(((orders.data ?? []) as Array<{ id: string; external_ref: string | null }>).map((row) => [row.id, row.external_ref]));
  const names = new Map(((clients.data ?? []) as Array<{ id: string; name: string | null }>).map((row) => [row.id, row.name]));
  overview.rows = flagged.map((row) => {
    const [carrier, ...line] = (row.planned_line ?? "").split("|");
    const planned = carrier ? { carrier, lineName: line.join("|") || null } : null;
    return {
      orderId: row.order_id,
      clientName: names.get(row.client_id) ?? null,
      referenceNo: row.reference_no,
      externalRef: refs.get(row.order_id) ?? null,
      destination: row.destination,
      zip: row.zip,
      weightG: row.weight_g,
      shippingMethod: row.shipping_method,
      plannedLine: row.planned_line,
      plannedMethod: exactShippingMethod(methodMap, planned),
      plannedCostRmb: row.planned_cost_rmb == null ? null : Number(row.planned_cost_rmb),
      actualLine: row.actual_line,
      actualCostRmb: row.actual_cost_rmb == null ? null : Number(row.actual_cost_rmb),
      extraRmb: row.extra_rmb == null ? null : Number(row.extra_rmb),
      status: row.status,
      open: isOpen(row),
      checkedAt: row.checked_at,
    };
  });
  return overview;
}
