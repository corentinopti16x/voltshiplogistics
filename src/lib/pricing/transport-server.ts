/**
 * Loader of the team « Transport » page (lines of the active grid for one country).
 * The page checks the role; the carrier costs only leave this module for an admin.
 */

import { parseShippingMethodMap, resolveShippingMethod } from "@/lib/eccang/mapping";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeDestination, type ShippingChannel } from "../domain/pricing";
import { getActiveGridVersion, loadRateCellsFor } from "./server";
import {
  summarizeTransportLines,
  TRANSPORT_CHANNELS,
  withoutCosts,
  type LineChannel,
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
};

/** Every (destination, line, channel) of the grid, without the per-gram prices (light query). */
async function loadLineChannels(gridVersion: string) {
  const admin = createAdminClient();
  const rows = new Map<string, LineChannel & { destination: string }>();
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await admin
      .from("rate_grid_cells")
      .select("destination, carrier, line_name, channel")
      .eq("grid_version", gridVersion)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ destination: string; carrier: string; line_name: string | null; channel: string }>) {
      const destination = row.destination.trim().toUpperCase();
      const lineName = row.line_name || null;
      const key = `${destination}|${row.carrier}|${lineName ?? ""}|${row.channel}`;
      if (!rows.has(key)) rows.set(key, { destination, carrier: row.carrier, lineName, channel: row.channel });
    }
    if (!data || data.length < 1000) break;
  }
  return [...rows.values()];
}

async function loadShippingMethods() {
  const admin = createAdminClient();
  const { data } = await admin.from("pricing_meta").select("value").eq("key", "eccang_shipping_methods").maybeSingle();
  return parseShippingMethodMap(data?.value);
}

export function parseTransportChannel(raw: string | null | undefined): ShippingChannel | null {
  return TRANSPORT_CHANNELS.find((channel) => channel === raw) ?? null;
}

/** `withCosts: false` strips every amount server-side (team members who are not admins). */
export async function loadTransportOverview(
  rawDestination: string | null | undefined,
  rawChannel: string | null | undefined,
  options: { withCosts: boolean },
): Promise<TransportOverview> {
  const gridVersion = await getActiveGridVersion();
  const wanted = parseTransportChannel(rawChannel);
  if (!gridVersion) {
    return { gridVersion: null, destinations: [], destination: null, channel: wanted ?? "standard", channels: [], lines: [] };
  }
  const [lineChannels, methods] = await Promise.all([loadLineChannels(gridVersion), loadShippingMethods()]);
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
  const destination = destinations.find((item) => item.code === asked)?.code ?? destinations[0]?.code ?? null;
  if (!destination) {
    return { gridVersion, destinations, destination: null, channel: wanted ?? "standard", channels: [], lines: [] };
  }
  const here = lineChannels.filter((row) => row.destination === destination);
  const present = new Set(here.map((row) => row.channel));
  const channels = TRANSPORT_CHANNELS.filter((channel) => present.has(channel));
  const channel = wanted && channels.includes(wanted) ? wanted : (channels[0] ?? "standard");
  const cells = await loadRateCellsFor(gridVersion, [destination], [channel]);
  const lines = summarizeTransportLines(cells, channel, here, (carrier, lineName) =>
    resolveShippingMethod(methods, carrier, lineName),
  );
  return { gridVersion, destinations, destination, channel, channels, lines: options.withCosts ? lines : withoutCosts(lines) };
}
