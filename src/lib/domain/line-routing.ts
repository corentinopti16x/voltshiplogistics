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
 * semicolons, tabs or spaces. "10000-10299" (numeric, same length) is expanded; 1-3 digit
 * entries are prefixes. In 5-digit markets (US, FR, DE, IT, ES) a 4-digit entry or range is
 * a code that lost its leading zero in Excel (2134 → 02134, 2101-2199 → 02101…02199).
 * US: ZIP+4 → ZIP.
 */
export function parseZipList(destination: string, text: string): { zips: string[]; invalid: string[] } {
  const market = normalizeDestination(destination, "");
  const full = ZIP_LENGTH[market] ?? 10;
  const padTo = full === 5 ? 5 : 0;
  const pad = (code: string) => (padTo && /^\d{4}$/.test(code) ? code.padStart(padTo, "0") : code);
  const zips = new Set<string>();
  const invalid: string[] = [];
  for (const token of text.split(/[\n\r,;\t ]+/)) {
    const entry = token.trim().replace(/^["']+|["']+$/g, "");
    if (!entry) continue;
    const range = entry.match(/^(\d+)[-–~](\d+)$/);
    // US "12345-6789" is a ZIP+4, not a range.
    const zipPlus4 = market === "US" && range && range[1].length === 5 && range[2].length === 4;
    if (range && !zipPlus4 && range[1].length === range[2].length && range[1].length <= full) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to >= from && to - from < MAX_ZIP_RANGE) {
        const width = padTo && range[1].length === 4 ? padTo : range[1].length;
        for (let code = from; code <= to; code += 1) zips.add(String(code).padStart(width, "0"));
        continue;
      }
    }
    const code = entry.toUpperCase().replace(/[\s-]+/g, "");
    if (market === "US") {
      if (/^\d{9}$/.test(code)) zips.add(code.slice(0, 5));
      else if (/^\d{1,5}$/.test(code)) zips.add(pad(code));
      else invalid.push(entry);
      continue;
    }
    if (/^[A-Z0-9]+$/.test(code) && code.length <= full) zips.add(pad(code));
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
  /** RMB per EUR (kept for callers that convert costs for display). */
  fxRmbPerEur: number;
  /**
   * Line to use when it can take the parcel: the line Voltship forces on the market, else
   * the client's own choice for the product (`_carrier_pref`). Null = cheapest.
   */
  preferredLine?: CarrierLineRef | null;
};

export type RouteIneligibleReason = "zip_not_covered" | "no_zip_list" | "no_zip";

export type RouteOption = CarrierLineRef & {
  key: string;
  /** INTERNAL carrier cost of the parcel in RMB at its billed weight; null when the grid has none. */
  costRmb: number | null;
  /** Client grid price (EUR) at the billed weight (used to compare lines without carrier cost). */
  price: number;
  /** The line's postcode list says yes / no; null = the line has no list. */
  zipCovered: boolean | null;
  eligible: boolean;
  reason: RouteIneligibleReason | null;
};

export type RouteResult = { best: RouteOption | null; options: RouteOption[] };

function costOf(cell: RateCell) {
  const cost = cell.carrierCostRmb;
  return cost != null && Number.isFinite(cost) && cost > 0 ? round2(cost) : null;
}

/** Cheaper first: by carrier cost when both lines have one, else by client grid price. */
function compareOptions(a: Pick<RouteOption, "costRmb" | "price">, b: Pick<RouteOption, "costRmb" | "price">) {
  if (a.costRmb != null && b.costRmb != null && a.costRmb !== b.costRmb) return a.costRmb - b.costRmb;
  if (a.costRmb != null && b.costRmb == null) return -1;
  if (a.costRmb == null && b.costRmb != null) return 1;
  return a.price - b.price;
}

/** One option per line (its cheapest bracket at the billed weight). */
function lineOptions(cells: RateCell[], input: RouteInput) {
  const byLine = new Map<string, RateCell>();
  for (const cell of rateCellsAt(cells, input)) {
    const key = lineKey(cell.carrier, cell.lineName);
    const known = byLine.get(key);
    if (!known || compareOptions({ costRmb: costOf(cell), price: cell.price }, { costRmb: costOf(known), price: known.price }) < 0) {
      byLine.set(key, cell);
    }
  }
  return [...byLine.entries()];
}

/**
 * Lines that can ship the parcel, cheapest carrier cost first, and the one Voltship uses
 * (`best`): the preferred line when it is eligible (bracket at this weight, postcode
 * covered), else the cheapest eligible line. Lines without carrier cost come after the costed ones. `best` is null when
 * no line is eligible (no bracket at this weight, or no line covers the postcode).
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
  const preferred = input.preferredLine ?? null;
  const options: RouteOption[] = lineOptions(cells, input).map(([key, cell]) => {
    const line = { carrier: cell.carrier, lineName: cell.lineName ?? null };
    const zipCovered = lineCoversZip(coverage, destination, line, zip);
    let reason: RouteIneligibleReason | null = null;
    if (zipCovered === false) reason = zip ? "zip_not_covered" : "no_zip";
    // Unlike the COGS display, a chosen / forced line gets no exemption: a carrier outside the
    // automatic set only ships where its postcode list says so.
    else if (zipCovered === null && auto.size > 0 && !auto.has(cell.carrier.toLowerCase())) reason = "no_zip_list";
    return { ...line, key, costRmb: costOf(cell), price: cell.price, zipCovered, eligible: reason === null, reason };
  });
  options.sort((a, b) => compareOptions(a, b) || a.key.localeCompare(b.key));
  const chosen = preferred ? options.find((option) => option.eligible && sameLine(option, preferred)) : undefined;
  return { best: chosen ?? options.find((option) => option.eligible) ?? null, options };
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
  /**
   * Actual − planned carrier cost (RMB) when both lines have one; > 0 = money lost. Null
   * when a cost is missing (the status then compares the client grid prices).
   */
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
  if (sameLine(actual, best)) return { status: "ok", planned: best, actual, extraRmb: 0 };
  const extraRmb = actual.costRmb != null && best.costRmb != null ? round2(actual.costRmb - best.costRmb) : null;
  const diff = extraRmb ?? actual.price - best.price;
  const status: LineCheckStatus = Math.abs(diff) < 0.005 ? "ok" : diff > 0 ? "more_expensive" : "cheaper";
  return { status, planned: best, actual, extraRmb: status === "ok" ? 0 : extraRmb };
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
