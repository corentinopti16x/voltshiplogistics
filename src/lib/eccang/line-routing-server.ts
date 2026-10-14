import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { callEccang, getCredentialsForClient, requireEccangClient, type ClientEccangConfig } from "@/lib/eccang/client";
import { allowedLinesFromRules } from "@/lib/domain/carrier-rules";
import {
  buildCoverageIndex,
  checkParcelLine,
  rankLines,
  type CoverageIndex,
  type LineCheck,
  type RouteInput,
  type ZipCoverage,
  type ZipCoverageMode,
} from "@/lib/domain/line-routing";
import {
  autoCarriersFor,
  hasInternalBattery,
  lineKey,
  normalizeDestination,
  type CarrierLineRef,
  type PackagingStep,
  type RateCell,
  type ShippingChannel,
  type VolumetricDivisors,
} from "@/lib/domain/pricing";
import { getActiveGridVersion, loadCarrierRules, loadRateCellsFor } from "@/lib/pricing/server";
import { readPricingSettings } from "@/lib/pricing/settings";
import { packPieces, productBox, productPackagingG } from "@/lib/products/extras";
import { parseShippingMethodMap, resolveShippingMethod, type ShippingMethodMap } from "@/lib/eccang/mapping";
import {
  lineForShippingMethod,
  modifyOrderPayload,
  parcelFactsFromRow,
  parcelFromItems,
  type ParcelEstimate,
  type ParcelProduct,
} from "@/lib/eccang/line-routing";

/**
 * ECCANG orders still waiting for review (C) and without label are moved to the planned
 * line with modifyOrder when ECCANG_REROUTE_ORDERS=1. Off by default: to switch on once
 * ECCANG has confirmed on one test order that modifyOrder keeps the order intact.
 */
export function appReroutesOrders() {
  return process.env.ECCANG_REROUTE_ORDERS === "1";
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

function isMissingTable(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "")));
}

export async function loadZipCoverage(): Promise<ZipCoverage[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("carrier_zip_coverage")
    .select("destination, carrier, line_name, mode, zips");
  if (isMissingTable(error)) return []; // Migration 00023 not applied yet.
  if (error) throw error;
  return ((data ?? []) as CoverageRow[]).map((row) => ({
    destination: row.destination,
    carrier: row.carrier,
    lineName: row.line_name || null,
    mode: row.mode === "except" ? "except" : "only",
    zips: row.zips ?? [],
  }));
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
}

export async function deleteZipCoverage(id: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("carrier_zip_coverage").delete().eq("id", id);
  if (error) throw error;
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
    (a, b) => a.destination.localeCompare(b.destination) || a.carrier.localeCompare(b.carrier) || (a.lineName ?? "").localeCompare(b.lineName ?? ""),
  );
}

// --- Routing context ---------------------------------------------------------------------

/** pricing_meta "eccang_shipping_methods" (same key as sync.ts, read here to avoid an import cycle). */
async function loadShippingMethodMap(): Promise<ShippingMethodMap> {
  const admin = createAdminClient();
  const { data } = await admin.from("pricing_meta").select("value").eq("key", "eccang_shipping_methods").maybeSingle();
  return parseShippingMethodMap(data?.value);
}

export type RoutingContext = {
  gridVersion: string;
  fx: number;
  autoCarriers: Record<string, string[]>;
  ladder: PackagingStep[];
  divisors: VolumetricDivisors;
  coverage: CoverageIndex;
  methodMap: ShippingMethodMap;
  cellsFor: (destination: string, channel: string) => Promise<RateCell[]>;
};

/** Live grid, pricing settings, postcode lists and ECCANG method map (cells loaded on demand). */
export async function loadRoutingContext(): Promise<RoutingContext | null> {
  const admin = createAdminClient();
  const gridVersion = await getActiveGridVersion();
  if (!gridVersion) return null;
  const [settings, coverages, methodMap] = await Promise.all([
    readPricingSettings(admin),
    loadZipCoverage(),
    loadShippingMethodMap(),
  ]);
  const cache = new Map<string, Promise<RateCell[]>>();
  return {
    gridVersion,
    fx: settings.fx_rmb_per_eur,
    autoCarriers: settings.auto_carriers,
    ladder: settings.packaging_ladder,
    divisors: settings.volumetric_divisors,
    coverage: buildCoverageIndex(coverages),
    methodMap,
    cellsFor(destination, channel) {
      const key = `${destination}|${channel}`;
      let cells = cache.get(key);
      if (!cells) {
        cells = loadRateCellsFor(gridVersion, [destination], [channel]);
        cache.set(key, cells);
      }
      return cells;
    },
  };
}

type ProductLookupRow = {
  sku: string | null;
  weight_g: number | null;
  shipping_channel: string | null;
  quote_json: Record<string, unknown> | null;
};

/** Weight / channel / battery / packaging of the client's products, by warehouse SKU. */
export async function loadParcelProducts(clientId: string): Promise<Map<string, ParcelProduct>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products_cache")
    .select("sku, weight_g, shipping_channel, quote_json")
    .eq("client_id", clientId)
    .not("sku", "is", null)
    .limit(5000);
  if (error) throw error;
  const products = new Map<string, ParcelProduct>();
  for (const row of (data ?? []) as ProductLookupRow[]) {
    const sku = row.sku?.trim();
    if (!sku) continue;
    const product: ParcelProduct = {
      weightG: row.weight_g,
      pieces: packPieces(row.quote_json),
      channel: row.shipping_channel,
      batteryInternal: hasInternalBattery(row.quote_json),
      boxWeightG: productBox(row.quote_json)?.weightG ?? 0,
      packagingWeightG: productPackagingG(row.quote_json),
    };
    // Duplicate sheets of one SKU: keep the one that has a weight.
    const known = products.get(sku);
    if (!known || (!(Number(known.weightG) > 0) && Number(product.weightG) > 0)) products.set(sku, product);
    if (!products.has(sku.toUpperCase())) products.set(sku.toUpperCase(), product);
  }
  return products;
}

export type PlannedParcel = {
  destination: string;
  parcel: ParcelEstimate;
  input: RouteInput;
  cells: RateCell[];
  autoCarriers: string[] | null;
};

/** Routing input of a parcel: destination, postcode, weight (billed when known), channel, allowed lines. */
export async function planParcel(
  ctx: RoutingContext,
  blocked: string[],
  facts: { country: string | null; zip: string | null; billedWeightG: number | null; items: Array<{ sku: string; quantity: number }> },
  products: ReadonlyMap<string, ParcelProduct>,
  options: { preferBilledWeight: boolean },
): Promise<PlannedParcel | null> {
  if (!facts.country || facts.items.length === 0) return null;
  const destination = normalizeDestination(facts.country);
  const parcel = parcelFromItems(facts.items, products, ctx.ladder);
  const weightG = options.preferBilledWeight && facts.billedWeightG ? facts.billedWeightG : parcel.weightG || facts.billedWeightG || 0;
  if (!(weightG > 0)) return null;
  const channel: ShippingChannel = parcel.channel ?? "standard";
  const cells = await ctx.cellsFor(destination, channel);
  const input: RouteInput = {
    destination,
    channel,
    weightG,
    quantity: 1,
    dimensionsCm: null,
    volumetricDivisors: ctx.divisors,
    batteryInternal: parcel.batteryInternal,
    allowedLines: allowedLinesFromRules(cells, { blocked, forced: {} }),
    zip: facts.zip,
    fxRmbPerEur: ctx.fx,
  };
  return { destination, parcel, input, cells, autoCarriers: autoCarriersFor(ctx.autoCarriers, destination) };
}

/** ECCANG shipping method of the line Voltship picks for this parcel (null = no line / unmapped). */
export function plannedMethod(ctx: RoutingContext, plan: PlannedParcel) {
  const { best } = rankLines(plan.cells, plan.input, ctx.coverage, plan.autoCarriers);
  if (!best) return { line: null, code: null };
  return { line: best as CarrierLineRef, code: resolveShippingMethod(ctx.methodMap, best.carrier, best.lineName) };
}

/**
 * Line of a Shopify order the app pushes to ECCANG (ECCANG_PUSH_ORDERS=1): cheapest line
 * covering the postcode for the whole parcel. `items` are units SOLD (converted to pieces
 * here). Null when the routing cannot decide (caller falls back to the product line).
 */
export async function routeShopifyOrder(
  clientId: string,
  address: { country_code?: string | null; zip?: string | null } | null | undefined,
  items: Array<{ product_sku: string; quantity: number }>,
): Promise<{ code: string | null; carrier: string; lineName: string | null } | null> {
  const ctx = await loadRoutingContext();
  if (!ctx) return null;
  const [products, rules] = await Promise.all([loadParcelProducts(clientId), loadCarrierRules(clientId)]);
  const pieces = items.map((item) => ({
    sku: item.product_sku,
    quantity: item.quantity * (products.get(item.product_sku)?.pieces ?? 1),
  }));
  const plan = await planParcel(
    ctx,
    rules.blocked,
    { country: address?.country_code ?? null, zip: address?.zip ?? null, billedWeightG: null, items: pieces },
    products,
    { preferBilledWeight: false },
  );
  if (!plan || plan.parcel.missing.length > 0) return null;
  const { line, code } = plannedMethod(ctx, plan);
  return line ? { code, carrier: line.carrier, lineName: line.lineName } : null;
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
  updated_at: string;
};

export type LineCheckSummary = {
  checked: number;
  moreExpensive: number;
  extraRmb: number;
  unknownLine: number;
  rerouted: number;
  rerouteErrors: number;
};

const EMPTY_SUMMARY: LineCheckSummary = { checked: 0, moreExpensive: 0, extraRmb: 0, unknownLine: 0, rerouted: 0, rerouteErrors: 0 };

/**
 * Every ECCANG order of the client changed in the last `days`: line Voltship plans vs the
 * line ECCANG put it on, both priced at the carrier cost (RMB) → eccang_order_line_checks.
 * Orders whose row did not change since the last check are skipped. With
 * ECCANG_REROUTE_ORDERS=1, orders still in review (C) without a label are moved to the
 * planned line (modifyOrder).
 */
export async function checkOrderLines(
  clientId: string,
  options: {
    days?: number;
    config?: ClientEccangConfig;
    context?: RoutingContext | null;
    /** Re-check orders already checked (after a grid or postcode-list change). */
    force?: boolean;
  } = {},
): Promise<LineCheckSummary> {
  const admin = createAdminClient();
  const ctx = options.context === undefined ? await loadRoutingContext() : options.context;
  if (!ctx) return EMPTY_SUMMARY;
  const since = new Date(Date.now() - (options.days ?? 3) * 86400000).toISOString();

  const rows: OrderRow[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await admin
      .from("eccang_orders")
      .select("id, reference_no, status, tracking_no, shipping_method, billed_weight_g, items_json, last_payload, updated_at")
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
  for (let i = 0; i < rows.length; i += 300) {
    const { data, error } = await admin
      .from("eccang_order_line_checks")
      .select("order_id, order_updated_at")
      .in("order_id", rows.slice(i, i + 300).map((row) => row.id));
    if (isMissingTable(error)) return EMPTY_SUMMARY; // Migration 00023 not applied yet.
    if (error) throw error;
    for (const check of data ?? []) previous.set(check.order_id as string, (check.order_updated_at as string | null) ?? null);
  }
  const todo = options.force ? rows : rows.filter((row) => {
    const at = previous.get(row.id);
    return at === undefined || at === null || new Date(at).getTime() !== new Date(row.updated_at).getTime();
  });
  if (todo.length === 0) return EMPTY_SUMMARY;

  const [products, rules] = await Promise.all([loadParcelProducts(clientId), loadCarrierRules(clientId)]);
  const reroute = appReroutesOrders();
  let credentials: ReturnType<typeof requireEccangClient>["credentials"] | null = null;
  if (reroute) {
    try {
      credentials = requireEccangClient(options.config ?? (await getCredentialsForClient(clientId))).credentials;
    } catch {
      credentials = null;
    }
  }

  const summary: LineCheckSummary = { ...EMPTY_SUMMARY };
  const now = new Date().toISOString();
  const upserts: Record<string, unknown>[] = [];
  for (const row of todo) {
    const facts = parcelFactsFromRow(row);
    const shipped = row.status === "D";
    const plan = await planParcel(ctx, rules.blocked, facts, products, { preferBilledWeight: shipped });
    const base = {
      order_id: row.id,
      client_id: clientId,
      reference_no: row.reference_no,
      destination: plan?.destination ?? facts.country,
      zip: facts.zip,
      weight_g: plan ? Math.round(plan.input.weightG) : facts.billedWeightG,
      shipping_method: facts.shippingMethod,
      order_updated_at: row.updated_at,
      checked_at: now,
    };
    if (!plan) {
      upserts.push({ ...base, status: "no_data", planned_line: null, planned_cost_rmb: null, actual_line: null, actual_cost_rmb: null, extra_rmb: null });
      continue;
    }
    const actualLine = lineForShippingMethod(ctx.methodMap, facts.shippingMethod);
    let check: LineCheck = checkParcelLine(plan.cells, plan.input, ctx.coverage, plan.autoCarriers, actualLine);
    let reroutedAt: string | null = null;
    let rerouteError: string | null = null;

    const open = row.status === "C" && !row.tracking_no;
    if (reroute && credentials && open && check.planned && check.status !== "ok" && check.status !== "no_plan") {
      const code = resolveShippingMethod(ctx.methodMap, check.planned.carrier, check.planned.lineName);
      const payload = code ? modifyOrderPayload((row.last_payload ?? {}) as Record<string, unknown>, code) : null;
      if (code && payload && code !== facts.shippingMethod) {
        try {
          await callEccang(credentials, "modifyOrder", payload);
          await admin.from("eccang_orders").update({ shipping_method: code }).eq("id", row.id);
          reroutedAt = now;
          summary.rerouted += 1;
          check = { status: "ok", planned: check.planned, actual: check.planned, extraRmb: 0 };
        } catch (error) {
          rerouteError = error instanceof Error ? error.message.slice(0, 500) : "modifyOrder failed";
          summary.rerouteErrors += 1;
        }
      }
    }

    summary.checked += 1;
    if (check.status === "more_expensive") {
      summary.moreExpensive += 1;
      summary.extraRmb += check.extraRmb ?? 0;
    }
    if (check.status === "unknown_line") summary.unknownLine += 1;
    upserts.push({
      ...base,
      status: check.status,
      planned_line: check.planned ? lineKey(check.planned.carrier, check.planned.lineName) : null,
      planned_cost_rmb: check.planned?.costRmb ?? null,
      actual_line: check.actual ? lineKey(check.actual.carrier, check.actual.lineName) : null,
      actual_cost_rmb: check.actual?.costRmb ?? null,
      extra_rmb: check.extraRmb,
      ...(reroutedAt ? { rerouted_at: reroutedAt } : {}),
      reroute_error: rerouteError,
    });
  }

  for (let i = 0; i < upserts.length; i += 300) {
    const { error } = await admin.from("eccang_order_line_checks").upsert(upserts.slice(i, i + 300), { onConflict: "order_id" });
    if (error) throw error;
  }
  summary.extraRmb = Math.round(summary.extraRmb * 100) / 100;
  return summary;
}

// --- Admin view --------------------------------------------------------------------------------

export type LineCheckRow = {
  orderId: string;
  clientId: string;
  clientName: string | null;
  referenceNo: string;
  externalRef: string | null;
  destination: string | null;
  zip: string | null;
  weightG: number | null;
  shippingMethod: string | null;
  plannedLine: string | null;
  plannedCostRmb: number | null;
  actualLine: string | null;
  actualCostRmb: number | null;
  extraRmb: number | null;
  status: string;
  reroutedAt: string | null;
  rerouteError: string | null;
  checkedAt: string;
};

export type LineCheckOverview = {
  migrated: boolean;
  days: number;
  checked: number;
  ok: number;
  moreExpensive: number;
  extraRmb: number;
  cheaper: number;
  unknownLine: number;
  noPlan: number;
  /** ECCANG shipping methods not mapped to a grid line, with how many orders used them. */
  unmappedMethods: Array<{ method: string; orders: number }>;
  rows: LineCheckRow[];
};

/** Last `days` of checks for the admin "Lignes" page (most expensive mistakes first). */
export async function lineCheckOverview(days = 7, limit = 200): Promise<LineCheckOverview> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const empty: LineCheckOverview = {
    migrated: true,
    days,
    checked: 0,
    ok: 0,
    moreExpensive: 0,
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
    rerouted_at: string | null;
    reroute_error: string | null;
    checked_at: string;
  };
  const all: CheckRow[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await admin
      .from("eccang_order_line_checks")
      .select(
        "order_id, client_id, reference_no, destination, zip, weight_g, shipping_method, planned_line, planned_cost_rmb, actual_line, actual_cost_rmb, extra_rmb, status, rerouted_at, reroute_error, checked_at",
      )
      .gte("checked_at", since)
      .order("order_id")
      .range(from, from + 999);
    if (isMissingTable(error)) return { ...empty, migrated: false };
    if (error) throw error;
    all.push(...((data ?? []) as CheckRow[]));
    if (!data || data.length < 1000) break;
  }
  const overview = { ...empty };
  const unmapped = new Map<string, number>();
  for (const row of all) {
    overview.checked += 1;
    if (row.status === "ok") overview.ok += 1;
    if (row.status === "more_expensive") {
      overview.moreExpensive += 1;
      overview.extraRmb += Number(row.extra_rmb) || 0;
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
    .sort((a, b) => (Number(b.extra_rmb) || 0) - (Number(a.extra_rmb) || 0) || b.checked_at.localeCompare(a.checked_at))
    .slice(0, limit);
  const orderIds = flagged.map((row) => row.order_id);
  const clientIds = [...new Set(flagged.map((row) => row.client_id))];
  const [orders, clients] = await Promise.all([
    orderIds.length
      ? admin.from("eccang_orders").select("id, external_ref").in("id", orderIds)
      : Promise.resolve({ data: [] as Array<{ id: string; external_ref: string | null }> }),
    clientIds.length
      ? admin.from("clients").select("id, name").in("id", clientIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string | null }> }),
  ]);
  const refs = new Map(((orders.data ?? []) as Array<{ id: string; external_ref: string | null }>).map((row) => [row.id, row.external_ref]));
  const names = new Map(((clients.data ?? []) as Array<{ id: string; name: string | null }>).map((row) => [row.id, row.name]));
  overview.rows = flagged.map((row) => ({
    orderId: row.order_id,
    clientId: row.client_id,
    clientName: names.get(row.client_id) ?? null,
    referenceNo: row.reference_no,
    externalRef: refs.get(row.order_id) ?? null,
    destination: row.destination,
    zip: row.zip,
    weightG: row.weight_g,
    shippingMethod: row.shipping_method,
    plannedLine: row.planned_line,
    plannedCostRmb: row.planned_cost_rmb == null ? null : Number(row.planned_cost_rmb),
    actualLine: row.actual_line,
    actualCostRmb: row.actual_cost_rmb == null ? null : Number(row.actual_cost_rmb),
    extraRmb: row.extra_rmb == null ? null : Number(row.extra_rmb),
    status: row.status,
    reroutedAt: row.rerouted_at,
    rerouteError: row.reroute_error,
    checkedAt: row.checked_at,
  }));
  return overview;
}
