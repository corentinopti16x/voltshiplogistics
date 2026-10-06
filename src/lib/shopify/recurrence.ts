import "server-only";

import {
  computeClientRecurrence,
  computeProductRecurrence,
  type ClientRecurrence,
  type ProductRecurrence,
  type RecurrenceOrder,
} from "@/lib/domain/recurrence";
import { unpackOrderLines } from "@/lib/shopify/order-cache";
import { createAdminClient } from "@/lib/supabase/admin";

export type RecurrenceSnapshot = {
  /** False when the client has no active Shopify shop. */
  shopConnected: boolean;
  client: ClientRecurrence;
  /** Per product SKU (only SKUs passed in). */
  products: Map<string, ProductRecurrence>;
};

async function hasActiveShop(clientId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("shops")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .limit(1);
  return (data ?? []).length > 0;
}

/** Every cached order of the client (90-day backfill + live webhook rows). */
async function loadRecurrenceOrders(
  clientId: string,
  shopId?: string | null,
): Promise<RecurrenceOrder[]> {
  const admin = createAdminClient();
  const rows: RecurrenceOrder[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("shopify_orders_cache")
      .select("order_date, cancelled, customer_key, line_items_json")
      .eq("client_id", clientId)
      .match(shopId ? { shop_id: shopId } : {})
      .order("order_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      rows.push({
        date: String(row.order_date),
        cancelled: Boolean(row.cancelled),
        customerKey: typeof row.customer_key === "string" ? row.customer_key : null,
        skus: unpackOrderLines(row.line_items_json).lines.map((line) => line.sku),
      });
    }
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

export async function loadClientRecurrence(
  clientId: string,
  skus: string[] = [],
  withinDays = 60,
  shopId?: string | null,
): Promise<RecurrenceSnapshot> {
  const [shopConnected, orders] = await Promise.all([
    hasActiveShop(clientId),
    loadRecurrenceOrders(clientId, shopId),
  ]);
  const products = new Map<string, ProductRecurrence>();
  for (const sku of new Set(skus)) {
    products.set(sku, computeProductRecurrence(orders, sku, withinDays));
  }
  return { shopConnected, client: computeClientRecurrence(orders), products };
}
