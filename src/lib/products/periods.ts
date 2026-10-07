/** Rolling windows offered to clients on the dashboard and the product views. */
export const DASHBOARD_PERIODS = ["24h", "7d", "30d"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];
export const PERIOD_MS: Record<DashboardPeriod, number> = {
  "24h": 86400000,
  "7d": 7 * 86400000,
  "30d": 30 * 86400000,
};

export function parseDashboardPeriod(raw: string | undefined | null): DashboardPeriod {
  return (DASHBOARD_PERIODS as readonly string[]).includes(raw ?? "")
    ? (raw as DashboardPeriod)
    : "7d";
}

export type PeriodStats = {
  /** Units sold in the window. */
  units: number;
  /** Orders containing the product. */
  orders: number;
  /** Units × Shopify line price; null when the cached orders carry no price yet. */
  revenue: number | null;
};
