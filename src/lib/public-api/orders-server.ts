import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hashCustomerEmail, unpackOrderLines } from "@/lib/shopify/order-cache";
import {
  parseOrderLookup,
  shapePublicOrder,
  type CachedOrder,
  type OrderLookup,
  type WarehouseOrder,
} from "./orders";

const ORDER_COLUMNS =
  "id, shopify_order_id, order_number, placed_at, order_date, cancelled, line_items_json, customer_key, customer_email_key, shop:shops(shopify_domain)";

type OrderRowWithShop = Omit<CachedOrder, "shop_domain"> & {
  shop: { shopify_domain: string } | { shopify_domain: string }[] | null;
};

function withShop(row: OrderRowWithShop): CachedOrder {
  const shop = Array.isArray(row.shop) ? row.shop[0] : row.shop;
  return { ...row, shop_domain: shop?.shopify_domain ?? null };
}

/** Tenant-scoped order lookup. Returns null when nothing matches (→ 404). */
export async function findCachedOrder(clientId: string, lookup: OrderLookup): Promise<CachedOrder | null> {
  const admin = createAdminClient();
  let query = admin.from("shopify_orders_cache").select(ORDER_COLUMNS).eq("client_id", clientId);
  if (lookup.kind === "reference") {
    const { data: wh } = await admin
      .from("eccang_orders")
      .select("shopify_order_id")
      .eq("client_id", clientId)
      .eq("reference_no", lookup.value)
      .maybeSingle();
    if (!wh?.shopify_order_id) return null;
    query = query.eq("shopify_order_id", wh.shopify_order_id);
  } else if (lookup.kind === "number") {
    query = query.eq("order_number", lookup.value);
  } else if (lookup.kind === "shopify_id") {
    query = query.eq("shopify_order_id", lookup.value);
  } else {
    query = query.eq("id", lookup.value);
  }
  const { data } = await query.order("order_date", { ascending: false }).limit(1).maybeSingle<OrderRowWithShop>();
  return data ? withShop(data) : null;
}

export async function loadWarehouseOrder(clientId: string, shopifyOrderId: string): Promise<WarehouseOrder | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("eccang_orders")
    .select("reference_no, status, tracking_no, carrier_code, shipping_method, shipped_at, billed_weight_g, updated_at")
    .eq("client_id", clientId)
    .eq("shopify_order_id", shopifyOrderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<WarehouseOrder>();
  return data ?? null;
}

async function loadTitles(clientId: string, skus: string[]) {
  if (skus.length === 0) return {};
  const admin = createAdminClient();
  const { data } = await admin
    .from("shopify_products_cache")
    .select("sku, title")
    .eq("client_id", clientId)
    .in("sku", skus);
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.sku && !out[row.sku]) out[row.sku] = row.title;
  return out;
}

/** Full public payload for a lookup string; `email` is only a second factor when provided. */
export async function resolvePublicOrder(input: { clientId: string; lookup: string; email?: string | null }) {
  const lookup = parseOrderLookup(input.lookup);
  if (!lookup) return { status: 404 as const };
  const order = await findCachedOrder(input.clientId, lookup);
  if (!order) return { status: 404 as const };
  if (input.email?.trim()) {
    const hash = hashCustomerEmail(input.email);
    if (hash !== order.customer_email_key && hash !== order.customer_key) return { status: 404 as const };
  }
  const warehouse = await loadWarehouseOrder(input.clientId, order.shopify_order_id);
  const { lines } = unpackOrderLines(order.line_items_json);
  const missing = lines.filter((line) => !line.title).map((line) => line.sku);
  const titles = await loadTitles(input.clientId, missing);
  return { status: 200 as const, body: shapePublicOrder(order, warehouse, titles) };
}
