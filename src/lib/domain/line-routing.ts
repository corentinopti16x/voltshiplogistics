/**
 * Line routing: which carrier line ships a parcel. Voltship decides it, not the carrier
 * nor the warehouse software:
 *
 * 1. Every line of the grid that can take the parcel (destination, channel, billed weight,
 *    blocked lines, built-in-battery lines) — `rateCellsAt`.
 * 2. Postcode coverage: a line with a postcode list (`carrier_zip_coverage`) ships only the
 *    codes of the list ("only") or every code but the list ("except"). A line WITHOUT a list
 *    is trusted for the market's automatic carriers (`auto_carriers`, e.g. US → YunExpress,
 *    Tongyou) and left out for the others (e.g. Huahan, which only covers part of the US)
 *    until its list is imported.
 * 3. The cheapest eligible line by carrier cost (RMB, at the exact billed gram).
 *
 * The same ranking prices the line a parcel actually left on, so a parcel shipped on a
 * dearer line than planned (14 Oct. 2026: 452 parcels on YunExpress 特惠 instead of 商派)
 * is flagged with its extra cost.
 */

import {
  lineKey,
  normalizeDestination,
  rateCellsAt,
  sameLine,
  type CarrierLineRef,
  type RateCell,
  type RateCellQuery,
} from "./pricing";

// --- Postcodes ------------------------------------------------------------------------

export type ZipCoverageMode = "only" | "except";

export type ZipCoverage = {
  destination: string;
  carrier: string;
  lineName: string | null;
  mode: ZipCoverageMode;
  /** Full codes ("10001") or prefixes ("100" = every code starting with 100). */
  zips: string[];
};

/** Full length of a postcode per market (prefixes are shorter); unknown markets: no length rule. */
const ZIP_LENGTH: Record<string, number> = { US: 5, FR: 5, DE: 5, IT: 5, ES: 5, BE: 4 };

/** Largest numeric range expanded from a pasted list ("10000-19999" = 10 000 codes). */
export const MAX_ZIP_RANGE = 100_000;

/**
 * Postcode as carriers list it: US → the 5-digit ZIP (ZIP+4 cut, leading zeros kept),
 * others → upper case without spaces or dashes. Null when nothing usable is left.
 */
export function normalizeZip(destination: string, raw: string | null | undefined): string | null {
  const market = normalizeDestination(destination, "");
  let text = String(raw ?? "").trim().toUpperCase();
  if (!text) return null;
  if (market === "US") {
    const match = text.match(/^(\d{1,5})(?:[-\s]?\d{4})?$/);
    if (!match) return null;
    // Excel drops the leading zeros of New England ZIPs ("2134" = 02134).
    return match[1].padStart(5, "0");
  }
  text = text.replace(/[\s-]+/g, "");
  return /^[A-Z0-9]{2,10}$/.test(text) ? text : null;
}

/**
 * Codes from a pasted list or a CSV column: one per line or separated by commas,
 * semicolons, tabs or spaces. "10000-10299" (numeric, same length) is expanded; entries
 * shorter than a full code are prefixes. US: ZIP+4 → ZIP, and a 4-digit entry is a ZIP that
 * lost its leading zero in Excel (2134 → 02134); 1-3 digits are prefixes.
 */
export function parseZipList(destination: string, text: string): { zips: string[]; invalid: string[] } {
  const market = normalizeDestination(destination, "");
  const full = ZIP_LENGTH[market] ?? 10;
  const zips = new Set<string>();
  const invalid: string[] = [];
  for (const token of text.split(/[\n\r,;\t ]+/)) {
    const entry = token.trim().replace(/^["']+|["']+$/g, "");
    if (!entry) continue;
    const range = entry.match(/^(\d+)[-–~](\d+)$/);
    if (range && range[1].length === range[2].length && range[1].length <= full) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to >= from && to - from < MAX_ZIP_RANGE) {
        for (let code = from; code <= to; code += 1) zips.add(String(code).padStart(range[1].length, "0"));
        continue;
      }
    }
    const code = entry.toUpperCase().replace(/[\s-]+/g, "");
    if (market === "US") {
      if (/^\d{9}$/.test(code)) zips.add(code.slice(0, 5));
      else if (/^\d{4}$/.test(code)) zips.add(code.padStart(5, "0"));
      else if (/^\d{1,3}$|^\d{5}$/.test(code)) zips.add(code);
      else invalid.push(entry);
      continue;
    }
    if (/^[A-Z0-9]+$/.test(code) && code.length <= full) zips.add(code);
    else invalid.push(entry);
  }
  return { zips: [...zips].sort(), invalid };
}

/** True when the code itself or one of its prefixes is in the list. */
export function zipInList(entries: ReadonlySet<string>, zip: string) {
  for (let length = zip.length; length >= 1; length -= 1) {
    if (entries.has(zip.slice(0, length))) return true;
  }
  return false;
}

export type CoverageIndex = Map<string, { mode: ZipCoverageMode; entries: Set<string> }>;

function coverageKey(destination: string, carrier: string, lineName: string | null | undefined) {
  return `${normalizeDestination(destination)}|${lineKey(carrier, lineName ?? null).toLowerCase()}`;
}

export function buildCoverageIndex(coverages: ZipCoverage[]): CoverageIndex {
  const index: CoverageIndex = new Map();
  for (const coverage of coverages) {
    index.set(coverageKey(coverage.destination, coverage.carrier, coverage.lineName), {
      mode: coverage.mode,
      entries: new Set(coverage.zips),
    });
  }
  return index;
}

/** true / false when the line has a postcode list for the market, null when it has none. */
export function lineCoversZip(
  index: CoverageIndex,
  destination: string,
  line: CarrierLineRef,
  zip: string | null,
): boolean | null {
  const coverage = index.get(coverageKey(destination, line.carrier, line.lineName));
  if (!coverage) return null;
  if (!zip) return coverage.mode === "except";
  const listed = zipInList(coverage.entries, zip);
  return coverage.mode === "only" ? listed : !listed;
}

// --- Ranking --------------------------------------------------------------------------

export type RouteInput = RateCellQuery & {
  /** Consignee postcode (any format; normalised per market). */
  zip: string | null | undefined;
  /** RMB per EUR, to compare a line without carrier cost on its grid price. */
  fxRmbPerEur: number;
};

export type RouteIneligibleReason = "zip_not_covered" | "no_zip_list" | "no_zip";

export type RouteOption = CarrierLineRef & {
  key: string;
  /** Carrier cost of the parcel in RMB at its billed weight (grid cost, else price × FX). */
  costRmb: number;
  /** True when `costRmb` comes from the carrier cost of the grid (not estimated from the price). */
  costKnown: boolean;
  /** Client grid price (EUR) of the bracket, for display. */
  price: number;
  /** The line's postcode list says yes / no; null = the line has no list. */
  zipCovered: boolean | null;
  eligible: boolean;
  reason: RouteIneligibleReason | null;
};

export type RouteResult = { best: RouteOption | null; options: RouteOption[] };

/** One option per line (its cheapest bracket at the billed weight), all lines, cheapest first. */
function lineOptions(cells: RateCell[], input: RouteInput) {
  const byLine = new Map<string, RateCell>();
  for (const cell of rateCellsAt(cells, input)) {
    const key = lineKey(cell.carrier, cell.lineName);
    const known = byLine.get(key);
    if (!known || costOf(cell, input.fxRmbPerEur).value < costOf(known, input.fxRmbPerEur).value) byLine.set(key, cell);
  }
  return [...byLine.entries()];
}

function costOf(cell: RateCell, fx: number) {
  const cost = cell.carrierCostRmb;
  if (cost != null && Number.isFinite(cost) && cost > 0) return { value: cost, known: true };
  return { value: cell.price * (fx > 0 ? fx : 7.5), known: false };
}

/**
 * Lines that can ship the parcel, cheapest carrier cost first, with the one Voltship
 * should use (`best`): the cheapest line covering the postcode. `best` is null when no
 * line is eligible (no bracket at this weight, or no line covers the postcode).
 */
export function rankLines(
  cells: RateCell[],
  input: RouteInput,
  coverage: CoverageIndex,
  autoCarriers?: string[] | null,
): RouteResult {
  const destination = normalizeDestination(input.destination);
  const zip = normalizeZip(destination, input.zip);
  const auto = new Set((autoCarriers ?? []).map((carrier) => carrier.toLowerCase()));
  const options: RouteOption[] = lineOptions(cells, input).map(([key, cell]) => {
    const line = { carrier: cell.carrier, lineName: cell.lineName ?? null };
    const zipCovered = lineCoversZip(coverage, destination, line, zip);
    let reason: RouteIneligibleReason | null = null;
    if (zipCovered === false) reason = zip ? "zip_not_covered" : "no_zip";
    else if (zipCovered === null && auto.size > 0 && !auto.has(cell.carrier.toLowerCase())) reason = "no_zip_list";
    const cost = costOf(cell, input.fxRmbPerEur);
    return {
      ...line,
      key,
      costRmb: round2(cost.value),
      costKnown: cost.known,
      price: cell.price,
      zipCovered,
      eligible: reason === null,
      reason,
    };
  });
  options.sort((a, b) => a.costRmb - b.costRmb || a.price - b.price || a.key.localeCompare(b.key));
  return { best: options.find((option) => option.eligible) ?? null, options };
}

// --- Planned vs actual ------------------------------------------------------------------

export type LineCheckStatus =
  /** Left on the planned line (or on a line as cheap). */
  | "ok"
  /** Left on a line that costs more than the planned one. */
  | "more_expensive"
  /** Left on a cheaper line than planned (e.g. a postcode list missing a code). */
  | "cheaper"
  /** The line used is not in the grid / not mapped to an ECCANG shipping method. */
  | "unknown_line"
  /** No line of the grid can take the parcel (weight, channel or postcode). */
  | "no_plan";

export type LineCheck = {
  status: LineCheckStatus;
  planned: RouteOption | null;
  actual: RouteOption | null;
  /** Actual − planned carrier cost (RMB) when both are known; > 0 = money lost. */
  extraRmb: number | null;
};

/**
 * Compares the line a parcel used (`actualLine`) with the line Voltship would have picked.
 * The actual line is priced with every line of the grid (even blocked or reserved ones),
 * so a parcel sent on a line we would never pick still gets its cost.
 */
export function checkParcelLine(
  cells: RateCell[],
  input: RouteInput,
  coverage: CoverageIndex,
  autoCarriers: string[] | null | undefined,
  actualLine: CarrierLineRef | null,
): LineCheck {
  const { best } = rankLines(cells, input, coverage, autoCarriers);
  const everyLine = rankLines(cells, { ...input, allowedLines: null, batteryInternal: true }, coverage, autoCarriers);
  const actual = actualLine ? (everyLine.options.find((option) => sameLine(option, actualLine)) ?? null) : null;
  if (!actual) return { status: "unknown_line", planned: best, actual: null, extraRmb: null };
  if (!best) return { status: "no_plan", planned: null, actual, extraRmb: null };
  const extra = round2(actual.costRmb - best.costRmb);
  const status: LineCheckStatus = sameLine(actual, best) || Math.abs(extra) < 0.005 ? "ok" : extra > 0 ? "more_expensive" : "cheaper";
  return { status, planned: best, actual, extraRmb: status === "ok" ? 0 : extra };
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
