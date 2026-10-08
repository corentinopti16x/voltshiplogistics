import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/server";
import {
  ORDER_ALERT_LABELS,
  detectOrderAnomalies,
  type OrderAlertReason,
  type OrderAnomalyDetails,
} from "@/lib/orders/anomalies";
import {
  isExcludedOrder,
  packOrderLines,
  unpackOrderLines,
  type OrderReview,
} from "@/lib/shopify/order-cache";
import type { ShopifyOrder } from "@/lib/shopify/admin-api";

export type { OrderAlertReason };

type Admin = ReturnType<typeof createAdminClient>;

/** New alerts on orders older than this are recorded silently (no WhatsApp for history). */
const NOTIFY_MAX_AGE_MS = 48 * 3600 * 1000;
/** Never more than this many WhatsApp / in-app pings per sync run. */
const NOTIFY_MAX_PER_RUN = 3;

export type OrderAlertRow = {
  id: string;
  client_id: string;
  shop_id: string;
  shopify_order_id: string;
  order_number: string | null;
  placed_at: string | null;
  reasons: string[];
  details: Partial<OrderAnomalyDetails> & { currency?: string | null };
  status: "open" | "legit" | "abuse";
  resolved_at: string | null;
  created_at: string;
};

export type OrderAlertMessageRow = {
  id: string;
  alert_id: string;
  author_role: "client" | "voltship" | "system";
  body: string;
  created_at: string;
};

export function orderUnits(order: Pick<ShopifyOrder, "line_items">) {
  return order.line_items.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
}

/** Anomalies of a Shopify order (webhook payload or REST backfill row). */
export function detectShopifyOrder(order: ShopifyOrder) {
  return detectOrderAnomalies({
    total: order.total_price,
    gross: order.total_line_items_price,
    discounts: order.total_discounts,
    discountCodes: order.discount_codes ?? null,
    units: orderUnits(order),
  });
}

/** Decisions already taken on this shop's alerts (order id → legit / abuse). Empty before migration 00017. */
export async function loadOrderReviews(admin: Admin, shopId: string) {
  const reviews = new Map<string, OrderReview>();
  const { data, error } = await admin
    .from("order_alerts")
    .select("shopify_order_id, status")
    .eq("shop_id", shopId)
    .in("status", ["legit", "abuse"]);
  if (error) return reviews;
  for (const row of data ?? []) {
    if (row.status === "legit" || row.status === "abuse") reviews.set(row.shopify_order_id, row.status);
  }
  return reviews;
}

export type AlertCandidate = {
  clientId: string;
  shopId: string;
  order: ShopifyOrder;
  reasons: OrderAlertReason[];
  details: OrderAnomalyDetails;
};

/**
 * Store new alerts (an order already flagged keeps its alert and its decision) and ping the client
 * for the recent ones. Never throws: alerts must not break the sales sync.
 */
export async function recordOrderAlerts(admin: Admin, candidates: AlertCandidate[]) {
  const rows = candidates
    .filter((candidate) => candidate.reasons.length > 0)
    .map((candidate) => ({
      client_id: candidate.clientId,
      shop_id: candidate.shopId,
      shopify_order_id: String(candidate.order.id),
      order_number: orderNumber(candidate.order),
      placed_at: candidate.order.created_at,
      reasons: candidate.reasons,
      details: { ...candidate.details, currency: candidate.order.currency ?? null },
    }));
  if (rows.length === 0) return 0;
  try {
    const { data, error } = await admin
      .from("order_alerts")
      .upsert(rows, { onConflict: "shop_id,shopify_order_id", ignoreDuplicates: true })
      .select("id, client_id, order_number, placed_at, reasons, details");
    if (error) return 0;
    const inserted = data ?? [];
    const now = Date.now();
    const recent = inserted
      .filter((row) => row.placed_at && now - Date.parse(row.placed_at) <= NOTIFY_MAX_AGE_MS)
      .slice(0, NOTIFY_MAX_PER_RUN);
    for (const row of recent) {
      await notifyClientOfAlert(row).catch(() => undefined);
    }
    return inserted.length;
  } catch {
    return 0;
  }
}

function orderNumber(order: ShopifyOrder) {
  if (order.order_number != null && String(order.order_number).trim()) return String(order.order_number).trim();
  return order.name?.replace(/^#/, "").trim() || null;
}

export function describeReasons(reasons: string[]) {
  return reasons
    .map((reason) => ORDER_ALERT_LABELS[reason as OrderAlertReason]?.title)
    .filter(Boolean)
    .join(" · ");
}

async function notifyClientOfAlert(row: {
  id: string;
  client_id: string;
  order_number: string | null;
  reasons: string[];
  details: Record<string, unknown> | null;
}) {
  const label = describeReasons(row.reasons);
  const number = row.order_number ? `#${row.order_number}` : "une commande";
  await createNotification({
    clientId: row.client_id,
    type: "order_alert",
    channels: ["in_app", "whatsapp"],
    payload: {
      alertId: row.id,
      orderNumber: row.order_number,
      reasons: row.reasons,
      details: row.details,
      href: "/alerts",
      message: `Commande à vérifier ${number} : ${label}`,
    },
  });
}

/**
 * Apply a decision to the cached order: "legit" puts it back in the sales, "abuse" takes it out.
 * Adjusts sales_cache by the order's SKU lines when its inclusion changes.
 */
export async function applyOrderReview(
  admin: Admin,
  alert: { client_id: string; shop_id: string; shopify_order_id: string },
  review: OrderReview,
) {
  const { data: row } = await admin
    .from("shopify_orders_cache")
    .select("order_date, cancelled, line_items_json")
    .eq("shop_id", alert.shop_id)
    .eq("shopify_order_id", alert.shopify_order_id)
    .maybeSingle();
  if (!row) return;
  const order = unpackOrderLines(row.line_items_json);
  const units = order.units ?? order.lines.reduce((sum, line) => sum + line.quantity, 0);
  const wasExcluded = order.suspicious;
  const nowExcluded = isExcludedOrder(order.total, units, review);
  await admin
    .from("shopify_orders_cache")
    .update({
      line_items_json: packOrderLines(order.lines, order.fulfilled === true, {
        amount: order.total,
        currency: order.currency,
        units,
        review,
        name: order.name,
      }),
      updated_at: new Date().toISOString(),
    })
    .eq("shop_id", alert.shop_id)
    .eq("shopify_order_id", alert.shopify_order_id);
  if (row.cancelled || wasExcluded === nowExcluded) return;
  const direction = nowExcluded ? -1 : 1;
  for (const line of order.lines) {
    await admin.rpc("increment_sales_cache", {
      p_client_id: alert.client_id,
      p_shop_id: alert.shop_id,
      p_sku: line.sku,
      p_date: row.order_date,
      p_units: line.quantity * direction,
    });
  }
}
