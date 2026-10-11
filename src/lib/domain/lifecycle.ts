import type { LifecycleStatus } from "@/lib/products/types";

export type LifecycleThresholds = {
  testingMaxAgeDays: number;
  /** Minimum units sold over the last 14 days (total, not per day) to be winning. */
  winningMinOrdersPerDay14d: number;
  decliningSalesDropPct: number;
  deadNoSalesDays: number;
};

export const DEFAULT_LIFECYCLE_THRESHOLDS: LifecycleThresholds = {
  testingMaxAgeDays: 60,
  winningMinOrdersPerDay14d: 5,
  decliningSalesDropPct: 50,
  deadNoSalesDays: 90,
};

export type DailySale = { date: string; units: number };

function daysBetween(a: Date, b: Date) {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

export function classifyLifecycle(input: {
  current: LifecycleStatus | null;
  createdDate: string | null;
  sales: DailySale[];
  now?: Date;
  thresholds?: LifecycleThresholds;
}) {
  if (input.current === "archived") return "archived" as const;
  const now = input.now ?? new Date();
  const thresholds = input.thresholds ?? DEFAULT_LIFECYCLE_THRESHOLDS;
  const dated = input.sales
    .map((row) => ({ ...row, day: new Date(`${row.date}T00:00:00Z`) }))
    .filter((row) => Number.isFinite(row.day.getTime()));
  const unitsSince = (fromDays: number, toDays = 0) =>
    dated
      .filter((row) => {
        const age = daysBetween(now, row.day);
        return age >= toDays && age < fromDays;
      })
      .reduce((sum, row) => sum + Math.max(0, row.units), 0);

  const last14 = unitsSince(14);
  const previous14 = unitsSince(28, 14);
  const latestSale = dated
    .filter((row) => row.units > 0)
    .sort((a, b) => b.day.getTime() - a.day.getTime())[0];
  const daysWithoutSale = latestSale
    ? daysBetween(now, latestSale.day)
    : input.createdDate
      ? daysBetween(now, new Date(`${input.createdDate}T00:00:00Z`))
      : Number.POSITIVE_INFINITY;

  if (daysWithoutSale >= thresholds.deadNoSalesDays) return "dead" as const;
  // A real seller (enough sales in the previous 14 days) whose sales halve is declining.
  if (previous14 >= thresholds.winningMinOrdersPerDay14d && previous14 > 0) {
    const dropPct = ((previous14 - last14) / previous14) * 100;
    if (dropPct >= thresholds.decliningSalesDropPct) return "declining" as const;
  }
  // Rule set by Voltship: at least N sales (default 5) over the last 14 days = winning.
  if (last14 >= thresholds.winningMinOrdersPerDay14d) return "winning" as const;
  return "testing" as const;
}

export function parseLifecycleThresholds(raw: unknown): LifecycleThresholds {
  if (!raw || typeof raw !== "object") return DEFAULT_LIFECYCLE_THRESHOLDS;
  const row = raw as Record<string, unknown>;
  const value = (key: string, fallback: number) => {
    const parsed = Number(row[key]);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    testingMaxAgeDays: value(
      "testing_max_age_days",
      DEFAULT_LIFECYCLE_THRESHOLDS.testingMaxAgeDays,
    ),
    winningMinOrdersPerDay14d: value(
      "winning_min_orders_per_day_14d",
      DEFAULT_LIFECYCLE_THRESHOLDS.winningMinOrdersPerDay14d,
    ),
    decliningSalesDropPct: value(
      "declining_sales_drop_pct",
      DEFAULT_LIFECYCLE_THRESHOLDS.decliningSalesDropPct,
    ),
    deadNoSalesDays: value(
      "dead_no_sales_days",
      DEFAULT_LIFECYCLE_THRESHOLDS.deadNoSalesDays,
    ),
  };
}
