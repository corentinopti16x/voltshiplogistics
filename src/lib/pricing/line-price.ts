/**
 * Price of ONE carrier line for one country, entered the way the carrier quotes it:
 * weight tiers, each with a price per kilo and a fee per parcel (both in RMB).
 *
 *   cost(g) = fee + per_kg × billable_g / 1000      billable_g = max(g, min billable weight)
 *
 * Pure (no I/O, no server import): the Transport page uses it in the browser to show the new
 * costs while typing, and the server uses it to build the grid cells. The cells are
 * gram-exact (one cost and one client price per gram), so a parcel keeps being billed at
 * its exact weight.
 */

export type LinePriceTier = {
  /** Heaviest parcel of the tier, in grams. A tier starts 1 g after the previous one. */
  maxG: number;
  perKgRmb: number;
  feeRmb: number;
};

export type LinePrice = {
  tiers: LinePriceTier[];
  /** The carrier bills at least this weight (0 = none). */
  minBillableG: number;
};

export type LinePriceError = "empty" | "weights" | "amounts" | "min_billable";

export const LINE_PRICE_MAX_TIERS = 8;
export const LINE_PRICE_MAX_G = 30_000;

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

/** Tiers sorted, numbers cleaned. Returns the first problem instead when the price cannot be used. */
export function normalizeLinePrice(
  raw: unknown,
): { ok: true; price: LinePrice } | { ok: false; error: LinePriceError } {
  const source = (raw ?? {}) as { tiers?: unknown; minBillableG?: unknown };
  const list = Array.isArray(source.tiers) ? source.tiers : [];
  if (list.length === 0 || list.length > LINE_PRICE_MAX_TIERS)
    return { ok: false, error: "empty" };
  const tiers: LinePriceTier[] = [];
  for (const entry of list) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const maxG = Number(record.maxG);
    const perKgRmb = Number(record.perKgRmb);
    const feeRmb = Number(record.feeRmb);
    if (!Number.isInteger(maxG) || maxG < 1 || maxG > LINE_PRICE_MAX_G)
      return { ok: false, error: "weights" };
    if (
      !Number.isFinite(perKgRmb) ||
      !Number.isFinite(feeRmb) ||
      perKgRmb < 0 ||
      feeRmb < 0 ||
      perKgRmb > 5000 ||
      feeRmb > 5000 ||
      perKgRmb + feeRmb <= 0
    )
      return { ok: false, error: "amounts" };
    tiers.push({ maxG, perKgRmb: round4(perKgRmb), feeRmb: round4(feeRmb) });
  }
  for (let index = 1; index < tiers.length; index += 1) {
    if (tiers[index].maxG <= tiers[index - 1].maxG)
      return { ok: false, error: "weights" };
  }
  const minBillableG =
    source.minBillableG == null || source.minBillableG === ""
      ? 0
      : Number(source.minBillableG);
  if (
    !Number.isInteger(minBillableG) ||
    minBillableG < 0 ||
    minBillableG > tiers[tiers.length - 1].maxG
  )
    return { ok: false, error: "min_billable" };
  return { ok: true, price: { tiers, minBillableG } };
}

/** Carrier cost (RMB) of a parcel of `weightG`; null when the line does not take that weight. */
export function linePriceCostRmb(
  price: LinePrice,
  weightG: number,
): number | null {
  const billable = Math.max(Math.round(weightG), price.minBillableG, 1);
  const tier = price.tiers.find((item) => billable <= item.maxG);
  if (!tier) return null;
  return round4(tier.feeRmb + (tier.perKgRmb * billable) / 1000);
}

/** Heaviest parcel the line takes. */
export function linePriceMaxG(price: LinePrice) {
  return price.tiers[price.tiers.length - 1]?.maxG ?? 0;
}

/** Grid brackets: 50 g steps to 2 kg, then 500 g steps, the last one ending at `maxG`. */
export function linePriceBrackets(maxG: number) {
  const brackets: Array<{ minG: number; maxG: number }> = [];
  let previous = -1;
  while (previous < maxG) {
    const step = previous < 2000 ? 50 : 500;
    const base = previous < 0 ? 0 : previous;
    const end = Math.min(maxG, Math.floor(base / step) * step + step);
    brackets.push({ minG: previous + 1, maxG: end });
    previous = end;
  }
  return brackets;
}

export type LinePriceCell = {
  weightMinG: number;
  weightMaxG: number;
  /** Flat values of the bracket (its heaviest gram), used where a grid has no per-gram price. */
  carrierCostRmb: number;
  price: number;
  /** One value per gram of the bracket, index 0 = weightMinG. */
  gramCostsRmb: number[];
  gramPrices: number[];
};

/**
 * Grid cells of the line. `clientPrice` is the Voltship margin rule (carrier cost in RMB →
 * client price in EUR): the same one the grid imports use, passed in so this file stays pure.
 */
export function buildLinePriceCells(
  price: LinePrice,
  clientPrice: (carrierCostRmb: number) => number,
): LinePriceCell[] {
  const cells: LinePriceCell[] = [];
  for (const bracket of linePriceBrackets(linePriceMaxG(price))) {
    const gramCostsRmb: number[] = [];
    for (let gram = bracket.minG; gram <= bracket.maxG; gram += 1) {
      gramCostsRmb.push(linePriceCostRmb(price, gram) as number);
    }
    const gramPrices = gramCostsRmb.map((cost) => clientPrice(cost));
    cells.push({
      weightMinG: bracket.minG,
      weightMaxG: bracket.maxG,
      carrierCostRmb: gramCostsRmb[gramCostsRmb.length - 1],
      price: gramPrices[gramPrices.length - 1],
      gramCostsRmb,
      gramPrices,
    });
  }
  return cells;
}

/**
 * Line names of the grid start with the carrier ("YunExpress THPHR-CHC"). A name typed or
 * pasted without it ("THPHR-CHC") is the same line: this gives the grid's form.
 */
export function gridLineName(carrier: string, lineName: string | null) {
  const name = (lineName ?? "").replace(/\s+/g, " ").trim();
  if (!name) return null;
  const prefix = `${carrier.trim()} `;
  return name.toLowerCase().startsWith(prefix.toLowerCase())
    ? name
    : `${prefix}${name}`;
}

/** The line name without the carrier in front, for display next to the carrier. */
export function shortLineName(carrier: string, lineName: string | null) {
  const name = (lineName ?? "").trim();
  const prefix = `${carrier.trim()} `;
  return name.toLowerCase().startsWith(prefix.toLowerCase())
    ? name.slice(prefix.length).trim()
    : name;
}

/** Key of a line's price in one country and one channel ("US|cosmetics|YunExpress|商派普货"). */
export function linePriceKey(line: {
  destination: string;
  channel: string;
  carrier: string;
  lineName?: string | null;
}) {
  return [
    line.destination.trim().toUpperCase(),
    line.channel,
    line.carrier.trim(),
    (line.lineName ?? "").trim(),
  ].join("|");
}
