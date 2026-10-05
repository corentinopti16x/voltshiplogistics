import "server-only";

/**
 * Finances — CONFIDENTIAL. Weekly profitability loaders for the owner (voltship_admin
 * only: every loader calls `assertVoltshipAdmin()` directly or through the margin
 * loaders it reuses). Never import from a client-facing page, component or route.
 *
 * Parcels are the ECCANG orders shipped in the week, valued with the same engine as
 * `/admin/margin` (`loadShippedOrderMargins`). A week without any ECCANG shipment falls
 * back to the Shopify orders placed that week, flagged "estimé".
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  assertVoltshipAdmin,
  loadEstimatedShopifyOrderMargins,
  loadShippedOrderMargins,
  type OrderMargin,
  type PricedOrderBatch,
} from "@/lib/pricing/margin-server";
import {
  addDays,
  buildFinanceWeek,
  isFinanceWeek,
  listWeeks,
  parisMidnightIso,
  weekEndOf,
  weekStartOf,
  type FinanceAdjustment,
  type FinanceWeek,
  type FixedCost,
  type FixedCostCategory,
  type FixedCostPeriod,
  type WeekInput,
} from "@/lib/finance/weeks";

export const FINANCE_WEEKS = 12;

// ---------------------------------------------------------------------------
// Fixed costs + adjustments
// ---------------------------------------------------------------------------

type FixedCostRow = {
  id: string;
  label: string;
  amount_eur: number | string;
  period: string;
  start_date: string;
  end_date: string | null;
  category: string;
  notes: string | null;
};

type AdjustmentRow = {
  id: string;
  week_start: string;
  label: string;
  amount_eur: number | string;
  kind: string;
  notes: string | null;
};

function toFixedCost(row: FixedCostRow): FixedCost {
  return {
    id: row.id,
    label: row.label,
    amountEur: Number(row.amount_eur) || 0,
    period: row.period as FixedCostPeriod,
    startDate: row.start_date,
    endDate: row.end_date,
    category: row.category as FixedCostCategory,
    notes: row.notes,
  };
}

function toAdjustment(row: AdjustmentRow): FinanceAdjustment {
  return {
    id: row.id,
    weekStart: row.week_start,
    label: row.label,
    amountEur: Number(row.amount_eur) || 0,
    kind: row.kind === "revenue" ? "revenue" : "cost",
    notes: row.notes,
  };
}

export async function listFixedCosts(): Promise<FixedCost[]> {
  await assertVoltshipAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fixed_costs")
    .select("id, label, amount_eur, period, start_date, end_date, category, notes")
    .order("category")
    .order("start_date", { ascending: false })
    .returns<FixedCostRow[]>();
  if (error) throw error;
  return (data ?? []).map(toFixedCost);
}

/** Adjustments whose week falls in [fromWeek, toWeek] (Mondays, inclusive); all when omitted. */
export async function listAdjustments(range?: { fromWeek: string; toWeek: string }): Promise<FinanceAdjustment[]> {
  await assertVoltshipAdmin();
  const admin = createAdminClient();
  let query = admin
    .from("finance_adjustments")
    .select("id, week_start, label, amount_eur, kind, notes")
    .order("week_start", { ascending: false })
    .order("created_at", { ascending: false });
  if (range) query = query.gte("week_start", range.fromWeek).lte("week_start", range.toWeek);
  const { data, error } = await query.returns<AdjustmentRow[]>();
  if (error) throw error;
  return (data ?? []).map(toAdjustment);
}

// ---------------------------------------------------------------------------
// Weekly computation + snapshot cache
// ---------------------------------------------------------------------------

export type WeeklyFinance = {
  /** Monday of the current week (Europe/Paris). */
  currentWeek: string;
  /** Ascending, oldest first; the last one is the current week. */
  weeks: FinanceWeek[];
  /** Week starts that were served from the snapshot cache. */
  cachedWeeks: string[];
  fixedCosts: FixedCost[];
};

function parcelsFromBatch(batch: PricedOrderBatch, orders: OrderMargin[]): WeekInput["parcels"] {
  return orders.map((order) => {
    const margin = order.margin;
    return {
      clientId: order.clientId,
      clientName: batch.clientNames.get(order.clientId) ?? order.clientId,
      figure: margin
        ? {
            clientId: order.clientId,
            clientName: batch.clientNames.get(order.clientId) ?? order.clientId,
            revenue: margin.clientPays.total,
            cost: margin.costs.total,
            margin: margin.margin.total,
            complete: margin.complete,
          }
        : null,
    };
  });
}

/** Group priced orders by the Europe/Paris ISO week of their shipped_at. */
function bucketByWeek(orders: OrderMargin[]) {
  const map = new Map<string, OrderMargin[]>();
  for (const order of orders) {
    if (!order.shippedAt) continue;
    const week = weekStartOf(order.shippedAt);
    const list = map.get(week) ?? [];
    list.push(order);
    map.set(week, list);
  }
  return map;
}

/**
 * The last `count` ISO weeks ending with the current one. The current and previous
 * weeks are always recomputed; older weeks come from `finance_weekly_snapshot` unless
 * `recompute` is set (or no snapshot exists).
 */
export async function loadWeeklyFinance(options: { count?: number; recompute?: boolean; now?: Date } = {}): Promise<WeeklyFinance> {
  await assertVoltshipAdmin();
  const count = Math.max(1, Math.min(52, options.count ?? FINANCE_WEEKS));
  const now = options.now ?? new Date();
  const currentWeek = weekStartOf(now);
  const weeks = listWeeks(currentWeek, count);
  const admin = createAdminClient();

  const [fixedCosts, adjustments, snapshotResult] = await Promise.all([
    listFixedCosts(),
    listAdjustments({ fromWeek: weeks[0], toWeek: currentWeek }),
    admin
      .from("finance_weekly_snapshot")
      .select("week_start, computed_at, payload")
      .gte("week_start", weeks[0])
      .lte("week_start", currentWeek),
  ]);
  const snapshots = new Map<string, FinanceWeek>();
  for (const row of snapshotResult.data ?? []) {
    if (isFinanceWeek(row.payload)) snapshots.set(row.week_start, row.payload);
  }

  const alwaysFresh = new Set([currentWeek, addDays(currentWeek, -7)]);
  const toCompute = weeks.filter((week) => options.recompute || alwaysFresh.has(week) || !snapshots.has(week));

  const computed = new Map<string, FinanceWeek>();
  if (toCompute.length > 0) {
    const sinceIso = parisMidnightIso(toCompute[0]);
    const untilIso = parisMidnightIso(addDays(toCompute[toCompute.length - 1], 7));
    const shipped = await loadShippedOrderMargins({ sinceIso, untilIso });
    const shippedByWeek = bucketByWeek(shipped.orders);

    // Weeks without any ECCANG shipment → Shopify orders placed that week (estimate).
    const estimateWeeks = toCompute.filter((week) => (shippedByWeek.get(week) ?? []).length === 0);
    let estimatedByWeek = new Map<string, OrderMargin[]>();
    let estimated: PricedOrderBatch | null = null;
    if (estimateWeeks.length > 0) {
      estimated = await loadEstimatedShopifyOrderMargins({
        fromDate: estimateWeeks[0],
        toDate: weekEndOf(estimateWeeks[estimateWeeks.length - 1]),
      });
      estimatedByWeek = bucketByWeek(estimated.orders);
    }

    const computedAt = new Date().toISOString();
    for (const week of toCompute) {
      const real = shippedByWeek.get(week) ?? [];
      const useEstimate = real.length === 0 && estimated != null;
      const orders = useEstimate ? (estimatedByWeek.get(week) ?? []) : real;
      const batch = useEstimate ? (estimated as PricedOrderBatch) : shipped;
      computed.set(
        week,
        buildFinanceWeek({
          weekStart: week,
          source: orders.length === 0 ? "none" : useEstimate ? "shopify_estimate" : "eccang",
          parcels: parcelsFromBatch(batch, orders),
          fixedCosts,
          adjustments,
          computedAt,
        }),
      );
    }
    // Cache every computed week (the current one too: harmless, and it becomes the
    // "previous week" cache next Monday).
    await admin.from("finance_weekly_snapshot").upsert(
      [...computed.entries()].map(([week_start, payload]) => ({ week_start, computed_at: computedAt, payload })),
      { onConflict: "week_start" },
    );
  }

  const cachedWeeks: string[] = [];
  const result = weeks.map((week) => {
    const fresh = computed.get(week);
    if (fresh) return fresh;
    cachedWeeks.push(week);
    return snapshots.get(week) as FinanceWeek;
  });
  return { currentWeek, weeks: result, cachedWeeks, fixedCosts };
}

/** Drop every cached week (after a fixed cost / adjustment change). */
export async function invalidateFinanceSnapshots() {
  const admin = createAdminClient();
  await admin.from("finance_weekly_snapshot").delete().gte("week_start", "1970-01-01");
}
