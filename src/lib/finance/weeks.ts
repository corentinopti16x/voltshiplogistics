/**
 * Finances — CONFIDENTIAL, voltship_admin only. Pure helpers (no I/O) behind the
 * weekly profitability view; `./weekly` does the data access.
 *
 * Weeks are ISO weeks (Monday → Sunday) in Europe/Paris, keyed by the Monday as
 * "YYYY-MM-DD". Formulas for one week:
 *
 *   revenue        = Σ clientPays.total per shipped parcel + revenue adjustments
 *   variable costs = Σ Voltship costs per parcel (factory + carrier + tax pass-through
 *                    + handling cost) + cost adjustments
 *   gross margin   = revenue − variable costs
 *   fixed costs    = Σ monthly × 12/52 + Σ weekly + Σ one_off falling in the week
 *   result         = gross margin − fixed costs
 *   break-even     = fixed costs ÷ average margin per parcel (null without parcels)
 *                    → parcels/week, then ÷ 7 (calendar days) and ÷ 5 (working days)
 */

export const FINANCE_TZ = "Europe/Paris";
export const WEEKS_PER_MONTH = 12 / 52;

export type FixedCostPeriod = "monthly" | "weekly" | "one_off";
export const FIXED_COST_PERIODS: FixedCostPeriod[] = ["monthly", "weekly", "one_off"];

export type FixedCostCategory = "loyer" | "salaires" | "outils" | "logistique" | "marketing" | "autre";
export const FIXED_COST_CATEGORIES: FixedCostCategory[] = [
  "loyer",
  "salaires",
  "outils",
  "logistique",
  "marketing",
  "autre",
];

export type AdjustmentKind = "revenue" | "cost";

export type FixedCost = {
  id: string;
  label: string;
  amountEur: number;
  period: FixedCostPeriod;
  /** "YYYY-MM-DD" */
  startDate: string;
  /** "YYYY-MM-DD" or null (open-ended). */
  endDate: string | null;
  category: FixedCostCategory;
  notes: string | null;
};

export type FinanceAdjustment = {
  id: string;
  /** Monday "YYYY-MM-DD". */
  weekStart: string;
  label: string;
  /** Signed EUR. */
  amountEur: number;
  kind: AdjustmentKind;
  notes: string | null;
};

// ---------------------------------------------------------------------------
// Calendar helpers (Europe/Paris)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: FINANCE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parisParts(at: Date) {
  const map: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(at)) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour % 24,
    minute: map.minute,
    second: map.second,
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function toDateString(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "YYYY-MM-DD" → UTC midnight ms of that calendar date (calendar arithmetic only). */
function dateStringToUtcMs(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: string, days: number) {
  const at = new Date(dateStringToUtcMs(date) + days * DAY_MS);
  return toDateString(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
}

/** Calendar date (Europe/Paris) of an instant. */
export function parisDateOf(at: Date | string): string {
  const date = typeof at === "string" ? new Date(at) : at;
  const parts = parisParts(date);
  return toDateString(parts.year, parts.month, parts.day);
}

/** Monday of the ISO week containing a calendar date "YYYY-MM-DD". */
export function weekStartOfDate(date: string): string {
  const weekday = new Date(dateStringToUtcMs(date)).getUTCDay(); // 0 = Sunday
  const back = (weekday + 6) % 7; // Monday → 0, Sunday → 6
  return addDays(date, -back);
}

/** Monday (Europe/Paris) of the ISO week containing an instant. */
export function weekStartOf(at: Date | string): string {
  return weekStartOfDate(parisDateOf(at));
}

export function weekEndOf(weekStart: string) {
  return addDays(weekStart, 6);
}

/** Offset of Europe/Paris vs UTC at a given instant, in minutes (+60 winter, +120 summer). */
function parisOffsetMinutes(at: Date) {
  const p = parisParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Instant (ISO) of local midnight in Europe/Paris for a calendar date. */
export function parisMidnightIso(date: string): string {
  const guess = dateStringToUtcMs(date);
  let result = guess - parisOffsetMinutes(new Date(guess)) * 60_000;
  // Re-check the offset at the result itself (DST switch nights).
  const again = guess - parisOffsetMinutes(new Date(result)) * 60_000;
  if (again !== result) result = again;
  return new Date(result).toISOString();
}

/** [Monday 00:00 Paris, next Monday 00:00 Paris) as ISO instants. */
export function weekBoundsIso(weekStart: string) {
  return { since: parisMidnightIso(weekStart), until: parisMidnightIso(addDays(weekStart, 7)) };
}

/** `count` week starts ending with `lastWeekStart`, ascending. */
export function listWeeks(lastWeekStart: string, count: number): string[] {
  const weeks: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) weeks.push(addDays(lastWeekStart, -7 * i));
  return weeks;
}

/** ISO week number (1–53) of a Monday — for labels. */
export function isoWeekNumber(weekStart: string) {
  const thursday = new Date(dateStringToUtcMs(addDays(weekStart, 3)));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - yearStart) / DAY_MS / 7) + 1;
}

export function isValidDateString(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = dateStringToUtcMs(value);
  if (!Number.isFinite(ms)) return false;
  const at = new Date(ms);
  return toDateString(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate()) === value;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Fixed costs
// ---------------------------------------------------------------------------

/** Share of one fixed cost that lands in the week starting `weekStart` (EUR). */
export function prorateFixedCost(cost: Pick<FixedCost, "amountEur" | "period" | "startDate" | "endDate">, weekStart: string) {
  const weekEnd = weekEndOf(weekStart);
  const amount = Number.isFinite(cost.amountEur) ? Math.max(0, cost.amountEur) : 0;
  if (cost.period === "one_off") {
    return cost.startDate >= weekStart && cost.startDate <= weekEnd ? amount : 0;
  }
  // Recurring: active if its [start, end] interval overlaps the week at all.
  const active = cost.startDate <= weekEnd && (cost.endDate == null || cost.endDate >= weekStart);
  if (!active) return 0;
  return cost.period === "monthly" ? amount * WEEKS_PER_MONTH : amount;
}

export type FixedCostsWeek = {
  total: number;
  byCategory: Partial<Record<FixedCostCategory, number>>;
};

export function fixedCostsForWeek(costs: FixedCost[], weekStart: string): FixedCostsWeek {
  const byCategory: Partial<Record<FixedCostCategory, number>> = {};
  let total = 0;
  for (const cost of costs) {
    const share = prorateFixedCost(cost, weekStart);
    if (share <= 0) continue;
    total += share;
    byCategory[cost.category] = (byCategory[cost.category] ?? 0) + share;
  }
  for (const key of Object.keys(byCategory) as FixedCostCategory[]) {
    byCategory[key] = money(byCategory[key] ?? 0);
  }
  return { total: money(total), byCategory };
}

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

export function sumAdjustments(adjustments: FinanceAdjustment[], weekStart: string) {
  let revenue = 0;
  let cost = 0;
  for (const adjustment of adjustments) {
    if (adjustment.weekStart !== weekStart || !Number.isFinite(adjustment.amountEur)) continue;
    if (adjustment.kind === "revenue") revenue += adjustment.amountEur;
    else cost += adjustment.amountEur;
  }
  return { revenue: money(revenue), cost: money(cost) };
}

// ---------------------------------------------------------------------------
// Break-even
// ---------------------------------------------------------------------------

export type BreakEven = {
  /** Parcels per week needed to cover the fixed costs; null without a usable margin per parcel. */
  parcelsPerWeek: number | null;
  /** parcelsPerWeek ÷ 7. */
  perDay: number | null;
  /** parcelsPerWeek ÷ 5 (working days). */
  perWorkingDay: number | null;
};

export function breakEven(fixedCostsWeek: number, marginPerParcel: number | null): BreakEven {
  if (marginPerParcel == null || !Number.isFinite(marginPerParcel) || marginPerParcel <= 0) {
    return { parcelsPerWeek: null, perDay: null, perWorkingDay: null };
  }
  const parcelsPerWeek = Math.max(0, fixedCostsWeek) / marginPerParcel;
  return {
    parcelsPerWeek: Math.round(parcelsPerWeek * 10) / 10,
    perDay: Math.round((parcelsPerWeek / 7) * 10) / 10,
    perWorkingDay: Math.round((parcelsPerWeek / 5) * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Week aggregation
// ---------------------------------------------------------------------------

/** One priced parcel, already valued by the margin engine. */
export type ParcelFigure = {
  clientId: string;
  clientName: string;
  /** What the client is billed (EUR). */
  revenue: number;
  /** Voltship variable cost (EUR, known components only). */
  cost: number;
  /** revenue − cost (margin engine total). */
  margin: number;
  /** False when a cost component is unknown (factory price / carrier cost). */
  complete: boolean;
};

/** Where the parcels of a week come from. */
export type WeekSource = "eccang" | "shopify_estimate" | "none";

export type FinanceWeekClient = {
  clientId: string;
  clientName: string;
  parcels: number;
  unpriced: number;
  revenue: number;
  cost: number;
  margin: number;
};

export type FinanceWeek = {
  weekStart: string;
  weekEnd: string;
  isoWeek: number;
  computedAt: string;
  source: WeekSource;
  /** True when the figures are estimated (Shopify orders instead of ECCANG shipments). */
  estimated: boolean;
  parcels: number;
  /** Parcels that could be valued (product matched + rate found). */
  pricedParcels: number;
  /** Priced parcels with at least one unknown cost component. */
  incompleteParcels: number;
  revenue: { parcels: number; adjustments: number; total: number };
  variableCosts: { parcels: number; adjustments: number; total: number };
  grossMargin: number;
  /** Gross margin of the parcels only ÷ priced parcels (adjustments excluded). */
  marginPerParcel: number | null;
  fixedCosts: FixedCostsWeek;
  result: number;
  breakEven: BreakEven;
  byClient: FinanceWeekClient[];
};

export type WeekInput = {
  weekStart: string;
  source: WeekSource;
  /** All parcels of the week; `null` figure = parcel that could not be priced. */
  parcels: Array<{ clientId: string; clientName: string; figure: ParcelFigure | null }>;
  fixedCosts: FixedCost[];
  adjustments: FinanceAdjustment[];
  computedAt?: string;
};

export function buildFinanceWeek(input: WeekInput): FinanceWeek {
  const { weekStart } = input;
  const clients = new Map<string, FinanceWeekClient>();
  let revenueParcels = 0;
  let costParcels = 0;
  let marginParcels = 0;
  let priced = 0;
  let incomplete = 0;

  for (const parcel of input.parcels) {
    const row = clients.get(parcel.clientId) ?? {
      clientId: parcel.clientId,
      clientName: parcel.clientName,
      parcels: 0,
      unpriced: 0,
      revenue: 0,
      cost: 0,
      margin: 0,
    };
    row.parcels += 1;
    if (parcel.figure) {
      priced += 1;
      if (!parcel.figure.complete) incomplete += 1;
      revenueParcels += parcel.figure.revenue;
      costParcels += parcel.figure.cost;
      marginParcels += parcel.figure.margin;
      row.revenue += parcel.figure.revenue;
      row.cost += parcel.figure.cost;
      row.margin += parcel.figure.margin;
    } else {
      row.unpriced += 1;
    }
    clients.set(parcel.clientId, row);
  }

  const adjustments = sumAdjustments(input.adjustments, weekStart);
  const revenueTotal = money(revenueParcels + adjustments.revenue);
  const costTotal = money(costParcels + adjustments.cost);
  const grossMargin = money(revenueTotal - costTotal);
  const fixedCosts = fixedCostsForWeek(input.fixedCosts, weekStart);
  const marginPerParcel = priced > 0 ? money(marginParcels / priced) : null;

  return {
    weekStart,
    weekEnd: weekEndOf(weekStart),
    isoWeek: isoWeekNumber(weekStart),
    computedAt: input.computedAt ?? new Date().toISOString(),
    source: input.source,
    estimated: input.source === "shopify_estimate",
    parcels: input.parcels.length,
    pricedParcels: priced,
    incompleteParcels: incomplete,
    revenue: { parcels: money(revenueParcels), adjustments: adjustments.revenue, total: revenueTotal },
    variableCosts: { parcels: money(costParcels), adjustments: adjustments.cost, total: costTotal },
    grossMargin,
    marginPerParcel,
    fixedCosts,
    result: money(grossMargin - fixedCosts.total),
    breakEven: breakEven(fixedCosts.total, marginPerParcel),
    byClient: [...clients.values()]
      .map((row) => ({ ...row, revenue: money(row.revenue), cost: money(row.cost), margin: money(row.margin) }))
      .sort((a, b) => b.margin - a.margin),
  };
}

/** Minimal structural check before trusting a cached snapshot payload. */
export function isFinanceWeek(value: unknown): value is FinanceWeek {
  if (!value || typeof value !== "object") return false;
  const week = value as Partial<FinanceWeek>;
  return (
    typeof week.weekStart === "string" &&
    typeof week.result === "number" &&
    typeof week.grossMargin === "number" &&
    !!week.revenue &&
    !!week.variableCosts &&
    !!week.fixedCosts &&
    !!week.breakEven &&
    Array.isArray(week.byClient)
  );
}
