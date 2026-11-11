/**
 * « Transport » page: every carrier line of the active grid for one country, with what it
 * accepts, its carrier cost at a few parcel weights, its delivery time and the ECCANG
 * shipping method it is linked to. Pure (no I/O) so the summary is unit-tested.
 *
 * INTERNAL: carries carrier costs in RMB — Voltship team pages only (never a client page).
 */

import { cellAtWeight, gridChannel, lineKey, type RateCell, type ShippingChannel } from "../domain/pricing";

/** Parcel weights shown side by side (grams). */
export const TRANSPORT_SAMPLE_WEIGHTS_G = [100, 300, 500, 1000] as const;

/** Channels a grid can carry (liquid_perfume is priced as cosmetics). */
export const TRANSPORT_CHANNELS: ShippingChannel[] = [
  "standard",
  "electronics_battery",
  "cosmetics",
  "magnetic",
  "sensitive_other",
];

export type TransportSample = {
  weightG: number;
  /** Carrier cost in RMB at this weight; null when the line has no bracket or no cost there. */
  costRmb: number | null;
  /** Client grid price in EUR at this weight; null when the line has no bracket there. */
  price: number | null;
  /** True when this is the lowest carrier cost of the country at this weight. */
  cheapest: boolean;
  /** True when the line has a bracket at this weight (kept when the costs are hidden). */
  available: boolean;
};

export type TransportLine = {
  key: string;
  carrier: string;
  lineName: string | null;
  /** Every channel the line has brackets for in this country. */
  channels: ShippingChannel[];
  deliveryRange: string | null;
  iossRequired: boolean;
  /** Lightest and heaviest parcel the line takes in the selected channel (grams). */
  minG: number;
  maxG: number;
  samples: TransportSample[];
  /** ECCANG shipping method linked to the line; null = not linked. */
  eccangMethod: string | null;
};

export type LineChannel = { carrier: string; lineName: string | null; channel: string };

function sampleAt(cells: RateCell[], weightG: number) {
  const bracket = cells
    .filter((cell) => weightG >= cell.weightMinG && weightG <= cell.weightMaxG)
    .sort((a, b) => a.weightMaxG - a.weightMinG - (b.weightMaxG - b.weightMinG))[0];
  if (!bracket) return { costRmb: null, price: null };
  const exact = cellAtWeight(bracket, weightG);
  const cost = exact.carrierCostRmb;
  return {
    costRmb: cost != null && Number.isFinite(cost) && cost > 0 ? Math.round(cost * 100) / 100 : null,
    price: Number.isFinite(exact.price) ? exact.price : null,
  };
}

/**
 * One entry per line that has brackets in `channel`, cheapest first (carrier cost at 300 g,
 * lines without cost last).
 *
 * @param cells brackets of ONE destination in the selected channel
 * @param lineChannels every (line, channel) pair of the destination, to list what a line accepts
 * @param methodFor ECCANG shipping method of a line, when linked
 */
export function summarizeTransportLines(
  cells: RateCell[],
  channel: ShippingChannel,
  lineChannels: LineChannel[],
  methodFor: (carrier: string, lineName: string | null) => string | null,
  weights: readonly number[] = TRANSPORT_SAMPLE_WEIGHTS_G,
): TransportLine[] {
  const wanted = gridChannel(channel);
  const byLine = new Map<string, RateCell[]>();
  for (const cell of cells) {
    if (cell.channel !== wanted) continue;
    const key = lineKey(cell.carrier, cell.lineName);
    byLine.set(key, [...(byLine.get(key) ?? []), cell]);
  }
  const accepted = new Map<string, Set<ShippingChannel>>();
  for (const row of lineChannels) {
    const key = lineKey(row.carrier, row.lineName);
    const set = accepted.get(key) ?? new Set<ShippingChannel>();
    set.add(gridChannel(row.channel) as ShippingChannel);
    accepted.set(key, set);
  }
  const lines: TransportLine[] = [...byLine.entries()].map(([key, lineCells]) => {
    const first = lineCells[0];
    const channels = TRANSPORT_CHANNELS.filter((item) => (accepted.get(key) ?? new Set([wanted])).has(item));
    return {
      key,
      carrier: first.carrier,
      lineName: first.lineName ?? null,
      channels,
      deliveryRange: lineCells.find((cell) => cell.deliveryRange)?.deliveryRange ?? null,
      iossRequired: lineCells.some((cell) => cell.iossRequired === true),
      minG: Math.min(...lineCells.map((cell) => cell.weightMinG)),
      maxG: Math.max(...lineCells.map((cell) => cell.weightMaxG)),
      samples: weights.map((weightG) => {
        const sample = sampleAt(lineCells, weightG);
        return { weightG, ...sample, cheapest: false, available: sample.price != null || sample.costRmb != null };
      }),
      eccangMethod: methodFor(first.carrier, first.lineName ?? null),
    };
  });
  weights.forEach((_, index) => {
    const costs = lines.map((line) => line.samples[index].costRmb).filter((cost): cost is number => cost != null);
    if (costs.length === 0) return;
    const lowest = Math.min(...costs);
    for (const line of lines) {
      const sample = line.samples[index];
      sample.cheapest = sample.costRmb != null && Math.abs(sample.costRmb - lowest) < 0.005;
    }
  });
  const rank = (line: TransportLine) => line.samples[Math.min(1, line.samples.length - 1)]?.costRmb ?? Number.POSITIVE_INFINITY;
  return lines.sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));
}

/**
 * Same lines without the client grid price (EUR): for the team members who configure the
 * transport but are not admins. They keep the carrier costs (RMB) they enter themselves;
 * client prices and margins stay admin-only.
 */
export function withoutClientPrices(lines: TransportLine[]): TransportLine[] {
  return lines.map((line) => ({
    ...line,
    samples: line.samples.map((sample) => ({ ...sample, price: null })),
  }));
}
