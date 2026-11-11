/**
 * Loader of the team « Transport » page (lines of the active grid for one country).
 * The page checks the role (Voltship team only); client prices only leave this module for an admin.
 */

import {
  parseShippingMethodMap,
  resolveShippingMethod,
} from "@/lib/eccang/mapping";
import { createAdminClient } from "@/lib/supabase/admin";
import { indexLineSettings } from "../domain/line-settings";
import {
  gridChannel,
  normalizeDestination,
  type ShippingChannel,
} from "../domain/pricing";
import type { ProductRow } from "../products/types";
import { loadLineSettings } from "./line-settings-server";
import {
  getActiveGridVersion,
  getProductMarkets,
  loadRateCellsFor,
} from "./server";
import {
  summarizeCountries,
  summarizeTransportLines,
  TRANSPORT_CHANNELS,
  withoutClientPrices,
  type CountryLineRow,
  type CountryRow,
  type TransportLine,
} from "./transport-view";

export type TransportOverview = {
  gridVersion: string | null;
  /** Countries of the active grid, most lines first. */
  destinations: Array<{ code: string; lines: number }>;
  destination: string | null;
  channel: ShippingChannel;
  /** Channels that have at least one line in the selected country. */
  channels: ShippingChannel[];
  lines: TransportLine[];
  /** False while migration 00025 is not applied: the lines cannot be configured yet. */
  settingsReady: boolean;
};

/** Every (destination, line, channel) of the grid, without the per-gram prices (light query). */
async function loadLineChannels(gridVersion: string) {
  const admin = createAdminClient();
  const rows = new Map<string, CountryLineRow>();
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await admin
      .from("rate_grid_cells")
      .select("destination, carrier, line_name, channel, delivery_range")
      .eq("grid_version", gridVersion)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{
      destination: string;
      carrier: string;
      line_name: string | null;
      channel: string;
      delivery_range: string | null;
    }>) {
      const destination = row.destination.trim().toUpperCase();
      const lineName = row.line_name || null;
      const key = `${destination}|${row.carrier}|${lineName ?? ""}|${row.channel}`;
      const known = rows.get(key);
      if (known) known.hasDelivery ||= !!row.delivery_range;
      else
        rows.set(key, {
          destination,
          carrier: row.carrier,
          lineName,
          channel: row.channel,
          hasDelivery: !!row.delivery_range,
        });
    }
    if (!data || data.length < 1000) break;
  }
  return [...rows.values()];
}

async function loadShippingMethods() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("pricing_meta")
    .select("value")
    .eq("key", "eccang_shipping_methods")
    .maybeSingle();
  return parseShippingMethodMap(data?.value);
}

export function parseTransportChannel(
  raw: string | null | undefined,
): ShippingChannel | null {
  return TRANSPORT_CHANNELS.find((channel) => channel === raw) ?? null;
}

/** `withClientPrices: false` strips the client grid prices server-side (team members who are not admins). */
export async function loadTransportOverview(
  rawDestination: string | null | undefined,
  rawChannel: string | null | undefined,
  options: { withClientPrices: boolean },
): Promise<TransportOverview> {
  const gridVersion = await getActiveGridVersion();
  const wanted = parseTransportChannel(rawChannel);
  if (!gridVersion) {
    return {
      gridVersion: null,
      destinations: [],
      destination: null,
      channel: wanted ?? "standard",
      channels: [],
      lines: [],
      settingsReady: false,
    };
  }
  const [lineChannels, methods, lineSettings] = await Promise.all([
    loadLineChannels(gridVersion),
    loadShippingMethods(),
    loadLineSettings(),
  ]);
  const settingsReady = lineSettings.ready;
  const perCountry = new Map<string, Set<string>>();
  for (const row of lineChannels) {
    const set = perCountry.get(row.destination) ?? new Set<string>();
    set.add(`${row.carrier}|${row.lineName ?? ""}`);
    perCountry.set(row.destination, set);
  }
  const destinations = [...perCountry.entries()]
    .map(([code, lines]) => ({ code, lines: lines.size }))
    .sort((a, b) => b.lines - a.lines || a.code.localeCompare(b.code));
  const asked = rawDestination ? normalizeDestination(rawDestination, "") : "";
  const destination =
    destinations.find((item) => item.code === asked)?.code ??
    destinations[0]?.code ??
    null;
  if (!destination) {
    return {
      gridVersion,
      destinations,
      destination: null,
      channel: wanted ?? "standard",
      channels: [],
      lines: [],
      settingsReady,
    };
  }
  const here = lineChannels.filter((row) => row.destination === destination);
  const present = new Set(here.map((row) => row.channel));
  const channels = TRANSPORT_CHANNELS.filter((channel) => present.has(channel));
  const channel =
    wanted && channels.includes(wanted) ? wanted : (channels[0] ?? "standard");
  // The page shows every line, including the ones not open yet.
  const cells = await loadRateCellsFor(gridVersion, [destination], [channel], {
    includePending: true,
  });
  const lines = summarizeTransportLines(
    cells,
    channel,
    here,
    (carrier, lineName) => resolveShippingMethod(methods, carrier, lineName),
    indexLineSettings(lineSettings.settings),
  );
  return {
    gridVersion,
    destinations,
    destination,
    channel,
    channels,
    lines: options.withClientPrices ? lines : withoutClientPrices(lines),
    settingsReady,
  };
}

/** Products per "COUNTRY|channel": every market of every product that is not archived. */
async function loadProductNeeds() {
  const admin = createAdminClient();
  const needs = new Map<string, number>();
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await admin
      .from("products_cache")
      .select("id, quote_json, shipping_channel, lifecycle_status")
      .not("shipping_channel", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    for (const product of (data ?? []) as ProductRow[]) {
      if (product.lifecycle_status === "archived") continue;
      const channel = gridChannel(product.shipping_channel as string);
      for (const market of getProductMarkets(product)) {
        const key = `${market}|${channel}`;
        needs.set(key, (needs.get(key) ?? 0) + 1);
      }
    }
    if (!data || data.length < 1000) break;
  }
  return needs;
}

export type CountriesOverview = {
  gridVersion: string | null;
  countries: CountryRow[];
};

/** Every country at once: open lines per product type and what is missing. */
export async function loadCountriesOverview(): Promise<CountriesOverview> {
  const gridVersion = await getActiveGridVersion();
  if (!gridVersion) return { gridVersion: null, countries: [] };
  const [rows, methods, lineSettings, needs] = await Promise.all([
    loadLineChannels(gridVersion),
    loadShippingMethods(),
    loadLineSettings(),
    loadProductNeeds(),
  ]);
  return {
    gridVersion,
    countries: summarizeCountries(
      rows,
      needs,
      (carrier, lineName) => resolveShippingMethod(methods, carrier, lineName),
      indexLineSettings(lineSettings.settings),
    ),
  };
}
