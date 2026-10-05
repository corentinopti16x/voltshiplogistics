/**
 * Repeat-purchase maths over the cached Shopify orders (90-day backfill + live webhooks).
 * Customers are identified only by `customerKey` (a hash); orders without a key are
 * counted in `ordersTotal` but excluded from every per-customer figure.
 */

export type RecurrenceOrder = {
  /** YYYY-MM-DD */
  date: string;
  cancelled: boolean;
  customerKey: string | null;
  skus: string[];
};

export type ClientRecurrence = {
  /** Non-cancelled orders in the window (with or without a customer key). */
  ordersTotal: number;
  /** Non-cancelled orders that carry a customer key. */
  ordersWithCustomer: number;
  customers: number;
  repeatCustomers: number;
  /** customers with ≥2 orders / customers; null when there are no customers. */
  repeatRate: number | null;
  /** ordersWithCustomer / customers; null when there are no customers. */
  ordersPerCustomer: number | null;
  /** Median days between a customer's 1st and 2nd order; null without repeat customers. */
  medianDaysToSecondOrder: number | null;
  /** Orders that are not a customer's first order / ordersWithCustomer; null without orders. */
  returningOrderShare: number | null;
  /** Days covered by the cached orders (first order date → today). */
  windowDays: number;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
};

export type ProductRecurrence = {
  /** Distinct customers who bought the SKU. */
  buyers: number;
  /** Buyers who placed any later order within `withinDays` of their first order of the SKU. */
  reorderers: number;
  /** reorderers / buyers; null without buyers. */
  reorderRate: number | null;
  withinDays: number;
};

const DAY_MS = 86_400_000;

function dayNumber(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function groupByCustomer(orders: RecurrenceOrder[]) {
  const byCustomer = new Map<string, RecurrenceOrder[]>();
  for (const order of orders) {
    if (order.cancelled || !order.customerKey) continue;
    const list = byCustomer.get(order.customerKey) ?? [];
    list.push(order);
    byCustomer.set(order.customerKey, list);
  }
  for (const list of byCustomer.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
  }
  return byCustomer;
}

export function computeClientRecurrence(
  orders: RecurrenceOrder[],
  today = new Date(),
): ClientRecurrence {
  const live = orders.filter((order) => !order.cancelled);
  const byCustomer = groupByCustomer(live);
  const customers = byCustomer.size;
  const ordersWithCustomer = live.filter((order) => order.customerKey).length;

  let repeatCustomers = 0;
  let returningOrders = 0;
  const gaps: number[] = [];
  for (const list of byCustomer.values()) {
    if (list.length >= 2) {
      repeatCustomers += 1;
      returningOrders += list.length - 1;
      gaps.push(dayNumber(list[1].date) - dayNumber(list[0].date));
    }
  }

  const dates = live.map((order) => order.date).sort();
  const firstOrderDate = dates[0] ?? null;
  const lastOrderDate = dates[dates.length - 1] ?? null;
  const todayDay = Math.floor(today.getTime() / DAY_MS);
  const windowDays = firstOrderDate ? Math.max(1, todayDay - dayNumber(firstOrderDate) + 1) : 0;

  return {
    ordersTotal: live.length,
    ordersWithCustomer,
    customers,
    repeatCustomers,
    repeatRate: customers > 0 ? repeatCustomers / customers : null,
    ordersPerCustomer: customers > 0 ? ordersWithCustomer / customers : null,
    medianDaysToSecondOrder: median(gaps),
    returningOrderShare: ordersWithCustomer > 0 ? returningOrders / ordersWithCustomer : null,
    windowDays,
    firstOrderDate,
    lastOrderDate,
  };
}

/**
 * Share of the SKU's buyers who re-ordered anything (any SKU) within `withinDays`
 * of their first order containing the SKU.
 */
export function computeProductRecurrence(
  orders: RecurrenceOrder[],
  sku: string,
  withinDays = 60,
): ProductRecurrence {
  const byCustomer = groupByCustomer(orders);
  let buyers = 0;
  let reorderers = 0;
  for (const list of byCustomer.values()) {
    const firstIndex = list.findIndex((order) => order.skus.includes(sku));
    if (firstIndex === -1) continue;
    buyers += 1;
    const firstDay = dayNumber(list[firstIndex].date);
    const reordered = list
      .slice(firstIndex + 1)
      .some((order) => dayNumber(order.date) - firstDay <= withinDays);
    if (reordered) reorderers += 1;
  }
  return {
    buyers,
    reorderers,
    reorderRate: buyers > 0 ? reorderers / buyers : null,
    withinDays,
  };
}
