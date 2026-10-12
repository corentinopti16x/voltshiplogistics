import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { unpackOrderLines } from "@/lib/shopify/order-cache";
import { loadProductSkus } from "@/lib/products/skus";
import { packPieces } from "@/lib/products/extras";
import { parseUpsellIds } from "@/lib/products/upsells";
import { CLIENT_PRODUCT_SELECT, serializeClientProduct } from "@/lib/products/visibility";
import {
  ageInDays,
  buildBuyList,
  DEFAULT_BUY_OPTIONS,
  eccangStateOf,
  isPendingShipment,
  orderRefKey,
  type BuyLine,
  type CatalogEntry,
  type EccangState,
  type PendingOrder,
} from "./to-ship";

async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error?: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; from < 500_000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export type AchatsData = {
  clients: Array<{ id: string; name: string }>;
  pending: PendingOrder[];
  buy: BuyLine[];
  since: string;
  salesSince: string;
};

type OrderRow = {
  client_id: string;
  shop_id: string;
  shopify_order_id: string;
  order_date: string;
  line_items_json: unknown;
};

type EccangRow = {
  client_id: string;
  shop_id: string | null;
  shopify_order_id: string | null;
  external_ref: string | null;
  status: string | null;
  eccang_order_code: string | null;
  tracking_no: string | null;
};

const RANK: Record<EccangState, number> = { none: 0, pending: 1, shipped: 2 };

/**
 * Orders not shipped since `since` (YYYY-MM-DD) and the buying plan (sales of the last
 * `salesWindowDays` days, stock, supplier orders, lead time, `coverDays` of cover).
 */
export async function loadAchats(input: { since: string; clientId?: string | null; coverDays?: number }): Promise<AchatsData> {
  const admin = createAdminClient();
  const options = { ...DEFAULT_BUY_OPTIONS, coverDays: input.coverDays ?? DEFAULT_BUY_OPTIONS.coverDays };
  const today = new Date();
  const salesFrom = new Date(today);
  salesFrom.setUTCDate(salesFrom.getUTCDate() - options.salesWindowDays);
  const salesSince = isoDay(salesFrom);
  const readFrom = input.since < salesSince ? input.since : salesSince;

  const [{ data: clientRows }, { data: shopRows }] = await Promise.all([
    admin.from("clients").select("id, name").order("name"),
    (() => {
      let query = admin.from("shops").select("id, client_id, shopify_domain, market");
      if (input.clientId) query = query.eq("client_id", input.clientId);
      return query;
    })(),
  ]);
  const clients = (clientRows ?? []).map((row) => ({ id: String(row.id), name: String(row.name ?? "") }));
  const clientName = new Map(clients.map((row) => [row.id, row.name]));
  const shops = new Map(
    (shopRows ?? []).map((row) => [
      String(row.id),
      { domain: String(row.shopify_domain ?? ""), market: (row.market as string | null) ?? null },
    ]),
  );

  const orders = await allRows<OrderRow>((from, to) => {
    let query = admin
      .from("shopify_orders_cache")
      .select("client_id, shop_id, shopify_order_id, order_date, line_items_json")
      .eq("cancelled", false)
      .gte("order_date", readFrom);
    if (input.clientId) query = query.eq("client_id", input.clientId);
    return query.order("id").range(from, to);
  });

  const eccangRows = await allRows<EccangRow>((from, to) => {
    let query = admin
      .from("eccang_orders")
      .select("client_id, shop_id, shopify_order_id, external_ref, status, eccang_order_code, tracking_no")
      .gte("created_at", `${input.since}T00:00:00Z`);
    if (input.clientId) query = query.eq("client_id", input.clientId);
    return query.order("id").range(from, to);
  }).catch(() => [] as EccangRow[]);
  const eccangByKey = new Map<string, { state: EccangState; tracking: string | null }>();
  const remember = (key: string, state: EccangState, tracking: string | null) => {
    const current = eccangByKey.get(key);
    if (!current || RANK[state] > RANK[current.state]) eccangByKey.set(key, { state, tracking });
  };
  for (const row of eccangRows) {
    const state = eccangStateOf(row.status, row.eccang_order_code);
    if (row.shop_id && row.shopify_order_id) remember(`order:${row.shop_id}:${row.shopify_order_id}`, state, row.tracking_no);
    const ref = orderRefKey(row.external_ref);
    if (ref) remember(`ref:${row.client_id}:${ref}`, state, row.tracking_no);
  }

  // Open « Commandes à vérifier » alerts (promo abuse, extra free gift…): to look at before sending.
  const alertRows = await allRows<{ shop_id: string; shopify_order_id: string }>((from, to) => {
    let query = admin
      .from("order_alerts")
      .select("shop_id, shopify_order_id")
      .eq("status", "open")
      .gte("placed_at", `${input.since}T00:00:00Z`);
    if (input.clientId) query = query.eq("client_id", input.clientId);
    return query.order("id").range(from, to);
  }).catch(() => [] as Array<{ shop_id: string; shopify_order_id: string }>);
  const openAlerts = new Set(alertRows.map((row) => `${row.shop_id}:${row.shopify_order_id}`));

  const pending: PendingOrder[] = [];
  const sold = new Map<string, { clientId: string; clientName: string; sku: string; title: string | null; units: number }>();
  for (const order of orders) {
    const unpacked = unpackOrderLines(order.line_items_json);
    const name = clientName.get(order.client_id) ?? "?";
    if (order.order_date >= salesSince && !unpacked.suspicious) {
      for (const line of unpacked.lines) {
        if (line.quantity <= 0) continue;
        const key = `${order.client_id}|${line.sku.toLowerCase()}`;
        const entry = sold.get(key) ?? { clientId: order.client_id, clientName: name, sku: line.sku, title: line.title ?? null, units: 0 };
        entry.units += line.quantity;
        sold.set(key, entry);
      }
    }
    if (order.order_date < input.since || !isPendingShipment(unpacked)) continue;
    const shop = shops.get(order.shop_id);
    if (!shop) continue;
    const eccang =
      eccangByKey.get(`order:${order.shop_id}:${order.shopify_order_id}`) ??
      eccangByKey.get(`ref:${order.client_id}:${orderRefKey(unpacked.name) ?? ""}`) ??
      eccangByKey.get(`ref:${order.client_id}:${orderRefKey(order.shopify_order_id) ?? ""}`) ??
      null;
    const units = unpacked.lines.reduce((sum, line) => sum + Math.max(0, line.quantity), 0);
    pending.push({
      clientId: order.client_id,
      clientName: name,
      shopId: order.shop_id,
      shopDomain: shop.domain.replace(/\.myshopify\.com$/i, ""),
      market: shop.market,
      orderId: order.shopify_order_id,
      name: unpacked.name,
      date: order.order_date,
      ageDays: ageInDays(order.order_date, today),
      lines: unpacked.lines,
      units,
      unitsWithoutSku: Math.max(0, (unpacked.units ?? units) - units),
      partial: unpacked.shipping?.status === "partial",
      flagged:
        (unpacked.suspicious && unpacked.review !== "legit") || openAlerts.has(`${order.shop_id}:${order.shopify_order_id}`),
      eccang: eccang?.state ?? "none",
      eccangTracking: eccang?.tracking ?? null,
    });
  }
  pending.sort((a, b) => b.ageDays - a.ageDays || a.clientName.localeCompare(b.clientName));

  const clientIds = [...new Set([...pending.map((order) => order.clientId), ...[...sold.values()].map((row) => row.clientId)])];
  const catalog = await loadCatalog(clientIds);
  const buy = buildBuyList(pending, sold, catalog, options);
  return { clients, pending, buy, since: input.since, salesSince };
}

async function loadCatalog(clientIds: string[]) {
  const catalog = new Map<string, Map<string, CatalogEntry>>();
  if (clientIds.length === 0) return catalog;
  const admin = createAdminClient();
  const products = (
    await allRows<Record<string, unknown>>((from, to) =>
      admin
        .from("products_cache")
        .select(CLIENT_PRODUCT_SELECT)
        .in("client_id", clientIds)
        .neq("lifecycle_status", "archived")
        .order("id")
        .range(from, to),
    )
  ).map((row) => serializeClientProduct(row));
  const productIds = products.map((product) => product.id);

  const [skus, stockRows, poRows, workRows] = await Promise.all([
    loadProductSkus(products),
    allRows<{ client_id: string; sku: string; qty_available: number | null; inbound_qty: number | null }>((from, to) =>
      admin
        .from("stock_cache")
        .select("client_id, sku, qty_available, inbound_qty")
        .in("client_id", clientIds)
        .order("id")
        .range(from, to),
    ).catch(() => []),
    allRows<{ product_id: string | null; quantity: number | null }>((from, to) =>
      admin
        .from("purchase_orders")
        .select("product_id, quantity")
        .in("client_id", clientIds)
        .not("status", "in", "(received,cancelled)")
        .order("id")
        .range(from, to),
    ).catch(() => []),
    (async () => {
      const rows: Array<{ product_id: string; factory_purchase_price: number | null; supplier_name: string | null }> = [];
      for (let i = 0; i < productIds.length; i += 200) {
        const { data } = await admin
          .from("sourcing_work")
          .select("product_id, factory_purchase_price, supplier_name")
          .in("product_id", productIds.slice(i, i + 200));
        rows.push(...((data ?? []) as typeof rows));
      }
      return rows;
    })(),
  ]);

  const stock = new Map(
    stockRows.map((row) => [
      `${row.client_id}|${String(row.sku).trim().toLowerCase()}`,
      { available: Number(row.qty_available) || 0, inbound: Number(row.inbound_qty) || 0 },
    ]),
  );
  const ordered = new Map<string, number>();
  for (const row of poRows) {
    if (row.product_id) ordered.set(row.product_id, (ordered.get(row.product_id) ?? 0) + (Number(row.quantity) || 0));
  }
  const work = new Map(workRows.map((row) => [row.product_id, row]));
  const upsellIds = new Set(products.flatMap((product) => parseUpsellIds(product.quote_json)));

  for (const product of products) {
    const map = catalog.get(product.client_id) ?? new Map<string, CatalogEntry>();
    catalog.set(product.client_id, map);
    const sourcing = work.get(product.id);
    const factory = sourcing?.factory_purchase_price != null ? Number(sourcing.factory_purchase_price) : null;
    for (const sku of new Set((skus.get(product.id) ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))) {
      const warehouse = stock.get(`${product.client_id}|${sku}`);
      const entry: CatalogEntry = {
        productId: product.id,
        title: product.title,
        isUpsell: upsellIds.has(product.id),
        stock: warehouse ? warehouse.available : product.stock_manual != null ? Number(product.stock_manual) : null,
        incoming: Math.max(warehouse?.inbound ?? 0, ordered.get(product.id) ?? 0),
        leadDays: product.production_lead_days && product.production_lead_days > 0 ? product.production_lead_days : null,
        factoryPriceRmb: factory != null && Number.isFinite(factory) ? factory : null,
        supplier: sourcing?.supplier_name ?? null,
        packPieces: packPieces(product.quote_json),
      };
      const current = map.get(sku);
      // Same SKU on several products (one per shop): keep the one with sourcing data.
      if (!current || (current.factoryPriceRmb == null && entry.factoryPriceRmb != null)) map.set(sku, entry);
      else if (current.isUpsell === false && entry.isUpsell) current.isUpsell = true;
    }
  }
  return catalog;
}

