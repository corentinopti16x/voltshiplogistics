/**
 * Price of one carrier line for one country, changed from the Transport page.
 *
 * - `previewLinePrice` : what the new price does before it is saved (carrier cost at the
 *   sample weights, and the COGS of every product it moves), without writing anything.
 * - `applyLinePrice`   : writes the line's cells in the ACTIVE grid, live at once. Only the
 *   cells of that line, that country and that channel are touched.
 *
 * The client price of every gram comes from `priceFromCarrierCost` with the saved pricing
 * settings: the same margin rule as the grid imports.
 */
import "server-only";

import {
  dropPendingLines,
  lineSettingKey,
} from "@/lib/domain/line-settings";
import {
  gridChannel,
  normalizeDestination,
  type RateCell,
  type ShippingChannel,
} from "@/lib/domain/pricing";
import type { ProductRow } from "@/lib/products/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceFromCarrierCost } from "./ai-import";
import { calculateCatalogQuotes } from "./catalog";
import {
  buildLinePriceCells,
  gridLineName,
  linePriceCostRmb,
  linePriceKey,
  normalizeLinePrice,
  type LinePrice,
  type LinePriceError,
} from "./line-price";
import { loadLineSettings, saveLineSetting } from "./line-settings-server";
import { getActiveGridVersion, loadRateCellsFor, markGridModified } from "./server";
import { readPricingSettings } from "./settings";
import {
  TRANSPORT_CHANNELS,
  TRANSPORT_SAMPLE_WEIGHTS_G,
} from "./transport-view";

/** pricing_meta key: the tiers last entered for each line, so the form opens pre-filled. */
export const LINE_PRICES_KEY = "transport_line_prices";

export type LinePriceTarget = {
  destination: string;
  channel: ShippingChannel;
  carrier: string;
  lineName: string | null;
};

export type StoredLinePrice = LinePrice & {
  updatedAt: string;
  updatedBy: string | null;
};

export type LinePriceFailure =
  | LinePriceError
  | "target"
  | "no_grid"
  | "exists"
  | "not_found"
  | "failed";

export type LinePricePreviewProduct = {
  id: string;
  title: string;
  client: string;
  /** COGS of 1 unit on this market (what the client pays), before and after. */
  before: number | null;
  after: number | null;
  /** The product ships on this line before / after the change. */
  onLineBefore: boolean;
  onLineAfter: boolean;
};

export type LinePricePreview = {
  samples: Array<{
    weightG: number;
    beforeRmb: number | null;
    afterRmb: number | null;
  }>;
  /** Products whose COGS or line changes, biggest change first (200 at most). */
  products: LinePricePreviewProduct[];
  /** How many products change, and how many were checked (this country, this product type). */
  changed: number;
  checked: number;
  /** The line is (or will be) « to open »: no product ships on it, so none changes. */
  pending: boolean;
};

function cleanTarget(
  raw: LinePriceTarget,
): LinePriceTarget | null {
  const destination = String(raw.destination ?? "")
    .trim()
    .toUpperCase();
  const carrier = String(raw.carrier ?? "")
    .replace(/\s+/g, " ")
    .trim();
  // Same form as the grid: "Carrier Line".
  const lineName = gridLineName(carrier, String(raw.lineName ?? ""));
  if (!/^[A-Z]{2}$/.test(destination)) return null;
  if (normalizeDestination(destination, "") !== destination) return null;
  if (!TRANSPORT_CHANNELS.includes(raw.channel)) return null;
  if (!/^[\p{L}\p{N} ._-]{1,40}$/u.test(carrier)) return null;
  if (lineName && (lineName.length > 120 || /[|\n]/.test(lineName)))
    return null;
  return { destination, channel: raw.channel, carrier, lineName };
}

function sameLine(cell: RateCell, target: LinePriceTarget) {
  return (
    cell.carrier === target.carrier &&
    (cell.lineName ?? "") === (target.lineName ?? "") &&
    cell.destination.trim().toUpperCase() === target.destination &&
    cell.channel === gridChannel(target.channel)
  );
}

function sampleCost(cells: RateCell[], weightG: number) {
  const cell = cells.find(
    (item) => weightG >= item.weightMinG && weightG <= item.weightMaxG,
  );
  if (!cell) return null;
  const cost =
    cell.gramCostsRmb?.[weightG - cell.weightMinG] ?? cell.carrierCostRmb;
  return cost != null && Number.isFinite(cost) && cost > 0
    ? Math.round(cost * 100) / 100
    : null;
}

async function readStoredPrices(): Promise<Record<string, StoredLinePrice>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("pricing_meta")
    .select("value")
    .eq("key", LINE_PRICES_KEY)
    .maybeSingle();
  try {
    const parsed = data?.value ? JSON.parse(data.value) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Tiers last entered for each line of one country and channel, by line key ("Carrier|Line"). */
export async function loadStoredLinePrices(
  destination: string,
  channel: ShippingChannel,
): Promise<Record<string, LinePrice>> {
  const all = await readStoredPrices();
  const prefix = `${destination.trim().toUpperCase()}|${channel}|`;
  const out: Record<string, LinePrice> = {};
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(prefix)) continue;
    const clean = normalizeLinePrice(value);
    if (clean.ok) out[key.slice(prefix.length)] = clean.price;
  }
  return out;
}

async function loadProducts(channel: ShippingChannel): Promise<ProductRow[]> {
  const admin = createAdminClient();
  // Perfume ships on the cosmetics lines of the grid.
  const channels =
    gridChannel(channel) === "cosmetics"
      ? ["cosmetics", "liquid_perfume"]
      : [channel];
  const rows: ProductRow[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await admin
      .from("products_cache")
      .select("*")
      .in("shipping_channel", channels)
      .not("client_price", "is", null)
      .not("weight_g", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as ProductRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows.filter((product) => product.lifecycle_status !== "archived");
}

type Prepared = {
  target: LinePriceTarget;
  price: LinePrice;
  gridVersion: string;
  /** Every cell of the country and channel, lines « to open » included. */
  all: RateCell[];
  current: RateCell[];
  next: RateCell[];
  taxIncluded: boolean;
  /** Notes carried by the line's cells (kept). */
  notes: string | null;
  /** The line has no cell at all in this country yet, whatever the product type. */
  brandNew: boolean;
};

async function prepare(
  rawTarget: LinePriceTarget,
  rawPrice: unknown,
  /** "auto" = create the line or replace its price, whichever applies (import of several lines). */
  isNew: boolean | "auto",
): Promise<{ ok: true; value: Prepared } | { ok: false; error: LinePriceFailure }> {
  const target = cleanTarget(rawTarget);
  if (!target) return { ok: false, error: "target" };
  const clean = normalizeLinePrice(rawPrice);
  if (!clean.ok) return { ok: false, error: clean.error };
  const gridVersion = await getActiveGridVersion();
  if (!gridVersion) return { ok: false, error: "no_grid" };
  const [all, settings] = await Promise.all([
    loadRateCellsFor(gridVersion, [target.destination], [target.channel], {
      includePending: true,
    }),
    readPricingSettings(createAdminClient()),
  ]);
  const current = all.filter((cell) => sameLine(cell, target));
  if (isNew === true && current.length > 0)
    return { ok: false, error: "exists" };
  if (isNew === false && current.length === 0)
    return { ok: false, error: "not_found" };
  // What the line's cells carry today, in any product type of this country.
  const { data: carried, error: carriedError } = await createAdminClient()
    .from("rate_grid_cells")
    .select("channel, tax_included, notes")
    .eq("grid_version", gridVersion)
    .eq("destination", target.destination)
    .eq("carrier", target.carrier)
    .eq("line_name", target.lineName ?? "")
    .limit(2000);
  if (carriedError) return { ok: false, error: "failed" };
  const carriedRows = (carried ?? []) as Array<{
    channel: string;
    tax_included: boolean | null;
    notes: string | null;
  }>;
  const here = carriedRows.filter(
    (row) => row.channel === gridChannel(target.channel),
  );
  // Grid prices are all-inclusive; a line imported with the parcel tax on top keeps it.
  const taxIncluded = !here.some((row) => row.tax_included === false);
  const notes = here.find((row) => row.notes)?.notes ?? null;
  const next: RateCell[] = buildLinePriceCells(clean.price, (cost) =>
    priceFromCarrierCost(cost, taxIncluded, settings),
  ).map((cell) => ({
    ...cell,
    gridVersion,
    carrier: target.carrier,
    lineName: target.lineName,
    destination: target.destination,
    channel: gridChannel(target.channel) as ShippingChannel,
    deliveryRange: current.find((item) => item.deliveryRange)?.deliveryRange ?? null,
    iossRequired: current.some((item) => item.iossRequired === true),
    taxIncluded,
  }));
  return {
    ok: true,
    value: {
      target,
      price: clean.price,
      gridVersion,
      all,
      current,
      next,
      taxIncluded,
      notes,
      brandNew: carriedRows.length === 0,
    },
  };
}

export async function previewLinePrice(
  rawTarget: LinePriceTarget,
  rawPrice: unknown,
  isNew: boolean,
): Promise<
  { ok: true; preview: LinePricePreview } | { ok: false; error: LinePriceFailure }
> {
  const prepared = await prepare(rawTarget, rawPrice, isNew);
  if (!prepared.ok) return prepared;
  const { target, price, all, current, next, brandNew } = prepared.value;

  const lineSettings = await loadLineSettings();
  const pendingKeys = new Set(
    lineSettings.settings
      .filter((setting) => setting.status === "pending")
      .map((setting) =>
        lineSettingKey(setting.destination, setting.carrier, setting.lineName),
      ),
  );
  const key = lineSettingKey(target.destination, target.carrier, target.lineName);
  // A brand-new line starts « to open » (when the settings table exists): nothing ships on it yet.
  const pending = brandNew ? lineSettings.ready : pendingKeys.has(key);
  if (pending) pendingKeys.add(key);

  const samples = TRANSPORT_SAMPLE_WEIGHTS_G.map((weightG) => ({
    weightG,
    beforeRmb: sampleCost(current, weightG),
    afterRmb: (() => {
      const cost = linePriceCostRmb(price, weightG);
      return cost == null ? null : Math.round(cost * 100) / 100;
    })(),
  }));

  let products: LinePricePreviewProduct[] = [];
  let checked = 0;
  if (!pending) {
    const candidates = await loadProducts(target.channel);
    const before = dropPendingLines(all, pendingKeys);
    const after = dropPendingLines(
      [...all.filter((cell) => !sameLine(cell, target)), ...next],
      pendingKeys,
    );
    const [quotesBefore, quotesAfter, clients] = await Promise.all([
      calculateCatalogQuotes(candidates, {
        markets: [target.destination],
        cells: before,
      }),
      calculateCatalogQuotes(candidates, {
        markets: [target.destination],
        cells: after,
      }),
      createAdminClient().from("clients").select("id, name"),
    ]);
    const clientName = new Map(
      ((clients.data ?? []) as Array<{ id: string; name: string }>).map(
        (client) => [client.id, client.name],
      ),
    );
    const onLine = (line: { carrier: string; lineName: string | null } | null) =>
      !!line &&
      line.carrier === target.carrier &&
      (line.lineName ?? "") === (target.lineName ?? "");
    for (const product of candidates) {
      const a = quotesBefore.get(product.id)?.markets[0];
      const b = quotesAfter.get(product.id)?.markets[0];
      if (!a && !b) continue;
      checked += 1;
      const beforeCogs = a?.cogs ?? null;
      const afterCogs = b?.cogs ?? null;
      const onLineBefore = onLine(a?.line ?? null);
      const onLineAfter = onLine(b?.line ?? null);
      const moved =
        onLineBefore !== onLineAfter ||
        (beforeCogs == null) !== (afterCogs == null) ||
        (beforeCogs != null &&
          afterCogs != null &&
          Math.abs(beforeCogs - afterCogs) >= 0.005);
      if (!moved) continue;
      products.push({
        id: product.id,
        title: product.title,
        client: clientName.get(product.client_id) ?? "",
        before: beforeCogs,
        after: afterCogs,
        onLineBefore,
        onLineAfter,
      });
    }
    const delta = (item: LinePricePreviewProduct) =>
      item.before != null && item.after != null
        ? Math.abs(item.after - item.before)
        : Number.POSITIVE_INFINITY;
    products = products.sort(
      (x, y) => delta(y) - delta(x) || x.title.localeCompare(y.title),
    );
  }
  return {
    ok: true,
    preview: {
      samples,
      changed: products.length,
      products: products.slice(0, 200),
      checked,
      pending,
    },
  };
}

export async function applyLinePrice(
  rawTarget: LinePriceTarget,
  rawPrice: unknown,
  isNew: boolean | "auto",
  userId: string,
): Promise<
  | {
      ok: true;
      target: LinePriceTarget;
      /** The line had no cell for this country and product type before. */
      created: boolean;
      gridVersion: string;
      cells: number;
      before: Array<number | null>;
      after: Array<number | null>;
      price: LinePrice;
    }
  | { ok: false; error: LinePriceFailure }
> {
  const prepared = await prepare(rawTarget, rawPrice, isNew);
  if (!prepared.ok) return prepared;
  const { target, price, gridVersion, current, next, taxIncluded, notes, brandNew } =
    prepared.value;
  const admin = createAdminClient();
  const channel = gridChannel(target.channel);
  const lineName = target.lineName ?? "";

  const rows = next.map((cell) => ({
    grid_version: gridVersion,
    carrier: target.carrier,
    destination: target.destination,
    channel,
    weight_min_g: cell.weightMinG,
    weight_max_g: cell.weightMaxG,
    price: cell.price,
    delivery_range: cell.deliveryRange ?? null,
    line_name: lineName,
    tax_included: taxIncluded,
    notes,
    carrier_cost_rmb: cell.carrierCostRmb,
    ioss_required: cell.iossRequired === true,
    gram_prices: cell.gramPrices,
    gram_costs_rmb: cell.gramCostsRmb,
  }));
  // New brackets first, old leftovers after: the line never disappears if a step fails.
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await admin
      .from("rate_grid_cells")
      .upsert(rows.slice(index, index + 200), {
        onConflict:
          "grid_version,carrier,destination,channel,weight_min_g,weight_max_g,line_name",
      });
    if (error) return { ok: false, error: "failed" };
  }
  const kept = new Set(rows.map((row) => `${row.weight_min_g}-${row.weight_max_g}`));
  const { data: existing, error: listError } = await admin
    .from("rate_grid_cells")
    .select("id, weight_min_g, weight_max_g")
    .eq("grid_version", gridVersion)
    .eq("destination", target.destination)
    .eq("channel", channel)
    .eq("carrier", target.carrier)
    .eq("line_name", lineName)
    .limit(5000);
  if (listError) return { ok: false, error: "failed" };
  const stale = ((existing ?? []) as Array<{
    id: string;
    weight_min_g: number;
    weight_max_g: number;
  }>)
    .filter((row) => !kept.has(`${row.weight_min_g}-${row.weight_max_g}`))
    .map((row) => row.id);
  for (let index = 0; index < stale.length; index += 100) {
    const { error } = await admin
      .from("rate_grid_cells")
      .delete()
      .in("id", stale.slice(index, index + 100));
    if (error) return { ok: false, error: "failed" };
  }

  await markGridModified(gridVersion).catch(() => null);

  // Remember what was typed, so the form opens with it next time.
  const stored = await readStoredPrices();
  stored[linePriceKey(target)] = {
    ...price,
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };
  await admin
    .from("pricing_meta")
    .upsert({ key: LINE_PRICES_KEY, value: JSON.stringify(stored) });

  // A brand-new line is not open at Voltship yet: no product ships on it until someone opens it.
  if (brandNew) {
    await saveLineSetting(
      {
        destination: target.destination,
        carrier: target.carrier,
        lineName: target.lineName,
      },
      { status: "pending" },
      userId,
    ).catch(() => null);
  }

  const round = (cost: number | null) =>
    cost == null ? null : Math.round(cost * 100) / 100;
  return {
    ok: true,
    target,
    created: current.length === 0,
    gridVersion,
    cells: rows.length,
    price,
    before: TRANSPORT_SAMPLE_WEIGHTS_G.map((weightG) =>
      sampleCost(current, weightG),
    ),
    after: TRANSPORT_SAMPLE_WEIGHTS_G.map((weightG) =>
      round(linePriceCostRmb(price, weightG)),
    ),
  };
}

/**
 * Product types a line accepts in one country. Adding a type copies the line's cells of
 * `copyFrom` (same prices) into the new type; removing a type deletes its cells from the
 * active grid. Removing the last type removes the line from that country.
 */
export async function setLineChannels(
  raw: { destination: string; carrier: string; lineName: string | null },
  change: { add: ShippingChannel[]; remove: ShippingChannel[]; copyFrom: ShippingChannel },
): Promise<
  | { ok: true; gridVersion: string; added: ShippingChannel[]; removed: ShippingChannel[] }
  | { ok: false; error: LinePriceFailure }
> {
  const target = cleanTarget({ ...raw, channel: change.copyFrom });
  const valid = (list: ShippingChannel[]) =>
    list.every((channel) => TRANSPORT_CHANNELS.includes(channel));
  if (!target || !valid(change.add) || !valid(change.remove))
    return { ok: false, error: "target" };
  if (change.add.some((channel) => change.remove.includes(channel)))
    return { ok: false, error: "target" };
  const gridVersion = await getActiveGridVersion();
  if (!gridVersion) return { ok: false, error: "no_grid" };
  const admin = createAdminClient();
  const line = () =>
    admin
      .from("rate_grid_cells")
      .select("*")
      .eq("grid_version", gridVersion)
      .eq("destination", target.destination)
      .eq("carrier", target.carrier)
      .eq("line_name", target.lineName ?? "");
  const { data, error } = await line().limit(5000);
  if (error) return { ok: false, error: "failed" };
  const cells = (data ?? []) as Array<Record<string, unknown> & { id: string; channel: string }>;
  const source = cells.filter((cell) => cell.channel === gridChannel(change.copyFrom));
  const present = new Set(cells.map((cell) => cell.channel));
  const added = change.add.filter((channel) => !present.has(channel));
  if (added.length > 0 && source.length === 0) return { ok: false, error: "not_found" };
  for (const channel of added) {
    const rows = source.map((cell) => {
      const copy: Record<string, unknown> = { ...cell, channel };
      delete copy.id;
      return copy;
    });
    for (let index = 0; index < rows.length; index += 200) {
      const { error: insertError } = await admin
        .from("rate_grid_cells")
        .insert(rows.slice(index, index + 200));
      if (insertError) return { ok: false, error: "failed" };
    }
  }
  const removed = change.remove.filter((channel) => present.has(channel));
  for (const channel of removed) {
    const { error: deleteError } = await admin
      .from("rate_grid_cells")
      .delete()
      .eq("grid_version", gridVersion)
      .eq("destination", target.destination)
      .eq("carrier", target.carrier)
      .eq("line_name", target.lineName ?? "")
      .eq("channel", channel);
    if (deleteError) return { ok: false, error: "failed" };
  }
  if (added.length > 0 || removed.length > 0) await markGridModified(gridVersion).catch(() => null);
  return { ok: true, gridVersion, added, removed };
}
