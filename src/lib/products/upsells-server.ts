import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { CLIENT_PRODUCT_SELECT, serializeClientProduct } from "@/lib/products/visibility";
import type { ProductRow } from "@/lib/products/types";
import { loadProductSkus } from "@/lib/products/skus";
import { unpackOrderLines } from "@/lib/shopify/order-cache";
import {
  coPurchases,
  mergeAutoUpsells,
  parseAutoUpsells,
  parseManualUpsellIds,
  parseUpsellIds,
  sameAutoUpsells,
  upsellPairs,
  upsellParentsOf,
} from "./upsells";
import type { OrderLine } from "@/lib/shopify/order-cache";

export type UpsellProduct = {
  product: ProductRow;
  /** Warehouse stock (stock_cache) when known, else the declared stock. */
  stock: number | null;
  /** Linked by hand, or detected from the orders (bought together `orders` times). */
  source: "manual" | "auto";
  orders: number | null;
};

export type UpsellSuggestion = {
  sku: string;
  title: string | null;
  orders: number;
  /** Share of the main product's orders that also contain it (0–1). */
  rate: number;
  /** App product carrying this SKU, null when the SKU has no product yet. */
  product: ProductRow | null;
};

/** Every non-archived product of a client. */
export async function clientProducts(clientId: string) {
  const admin = createAdminClient();
  const out: ProductRow[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data } = await admin
      .from("products_cache")
      .select(CLIENT_PRODUCT_SELECT)
      .eq("client_id", clientId)
      .neq("lifecycle_status", "archived")
      .order("id")
      .range(from, from + 999);
    out.push(...(data ?? []).map((row) => serializeClientProduct(row as Record<string, unknown>)));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function stockBySku(clientId: string, skus: string[]) {
  const map = new Map<string, number>();
  if (skus.length === 0) return map;
  const admin = createAdminClient();
  const { data } = await admin.from("stock_cache").select("sku, qty_available").eq("client_id", clientId).in("sku", skus);
  for (const row of data ?? []) map.set(String(row.sku), Number(row.qty_available) || 0);
  return map;
}

/** Linked upsells of a product (same client), with stock. */
export async function loadUpsells(product: ProductRow): Promise<UpsellProduct[]> {
  const ids = parseUpsellIds(product.quote_json);
  if (ids.length === 0) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("products_cache")
    .select(CLIENT_PRODUCT_SELECT)
    .eq("client_id", product.client_id)
    .in("id", ids);
  const rows = (data ?? []).map((row) => serializeClientProduct(row as Record<string, unknown>));
  const stock = await stockBySku(
    product.client_id,
    rows.map((row) => row.sku).filter((sku): sku is string => !!sku),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const manual = new Set(parseManualUpsellIds(product.quote_json));
  const auto = new Map(parseAutoUpsells(product.quote_json).map((item) => [item.id, item.orders]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is ProductRow => !!row)
    .map((row) => ({
      product: row,
      stock: row.sku && stock.has(row.sku) ? (stock.get(row.sku) as number) : row.stock_manual ?? null,
      source: manual.has(row.id) ? ("manual" as const) : ("auto" as const),
      orders: auto.get(row.id) ?? null,
    }));
}

/** Lines of the client's real orders (not cancelled, not flagged) of the last `days` days. */
async function recentOrderLines(clientId: string, days: number, multiOnly = false) {
  const admin = createAdminClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const orders: OrderLine[][] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await admin
      .from("shopify_orders_cache")
      .select("id, line_items_json")
      .eq("client_id", clientId)
      .eq("cancelled", false)
      .gte("order_date", since)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const unpacked = unpackOrderLines(row.line_items_json);
      if (!unpacked.suspicious && (!multiOnly || unpacked.lines.length > 1)) orders.push(unpacked.lines);
    }
    if (!data || data.length < 1000) break;
  }
  return orders;
}

/** SKU (lower case) → products of the client carrying it (variants included; a SKU can sit on duplicates). */
async function productsBySku(products: ProductRow[]) {
  const skus = await loadProductSkus(products);
  const bySku = new Map<string, ProductRow[]>();
  for (const row of products) {
    for (const sku of new Set((skus.get(row.id) ?? []).map((value) => value.trim().toLowerCase()))) {
      bySku.set(sku, [...(bySku.get(sku) ?? []), row]);
    }
  }
  return { skus, bySku };
}

/**
 * Detects the upsells of every product of a client from its Shopify orders: a product bought
 * at least once in the same order as a dearer one becomes its upsell (quote_json.upsell_auto).
 * `days` ≥ 90 recounts everything; fewer days (sync every 10 min) only adds what is new.
 */
export async function refreshAutoUpsells(clientId: string, options: { days?: number } = {}) {
  const days = Math.min(90, Math.max(1, options.days ?? 90));
  const full = days >= 90;
  const products = await clientProducts(clientId);
  if (products.length < 2) return { updated: 0, orders: 0 };
  const [{ bySku }, orders] = await Promise.all([productsBySku(products), recentOrderLines(clientId, days, true)]);
  const mapped = orders.map((lines) =>
    lines.flatMap((line) =>
      (bySku.get(line.sku.trim().toLowerCase()) ?? []).map((match) => ({ productId: match.id, price: line.price ?? null })),
    ),
  );
  const listPrice = new Map(products.map((row) => [row.id, row.client_price != null ? Number(row.client_price) : null]));
  const pairs = upsellPairs(mapped, (id) => listPrice.get(id) ?? null);
  const admin = createAdminClient();
  let updated = 0;
  for (const product of products) {
    const existing = parseAutoUpsells(product.quote_json);
    const next = mergeAutoUpsells(existing, pairs.get(product.id), full);
    if (sameAutoUpsells(existing, next)) continue;
    // Fresh quote_json right before the write: the sheet may have been saved meanwhile.
    const { data } = await admin.from("products_cache").select("quote_json").eq("id", product.id).maybeSingle();
    const quote = (data?.quote_json as Record<string, unknown> | null) ?? {};
    const { error } = await admin
      .from("products_cache")
      .update({ quote_json: { ...quote, upsell_auto: next, upsell_auto_at: new Date().toISOString() } })
      .eq("id", product.id);
    if (!error) updated += 1;
  }
  return { updated, orders: orders.length };
}

/** Auto-upsell detection for every client with a connected shop (Shopify sync cron). */
export async function refreshAutoUpsellsForShops(options: { days?: number } = {}) {
  const admin = createAdminClient();
  const { data: shops } = await admin.from("shops").select("client_id").eq("status", "active");
  const clientIds = [...new Set((shops ?? []).map((shop) => String(shop.client_id)))];
  let updated = 0;
  const errors: string[] = [];
  for (const clientId of clientIds) {
    try {
      updated += (await refreshAutoUpsells(clientId, options)).updated;
    } catch (error) {
      errors.push(`${clientId}: ${error instanceof Error ? error.message : "upsells failed"}`);
    }
  }
  return { clients: clientIds.length, updated, errors };
}

/**
 * Upsell candidates: SKUs bought in the same Shopify orders as the product over the last
 * `days` days, mapped to the client's products. Already linked upsells are left out.
 */
export async function suggestUpsells(product: ProductRow, days = 90): Promise<{ mainOrders: number; items: UpsellSuggestion[] }> {
  const products = await clientProducts(product.client_id);
  const { skus, bySku: productBySku } = await productsBySku(products);
  const mainSkus = new Set(skus.get(product.id) ?? (product.sku ? [product.sku] : []));
  if (mainSkus.size === 0) return { mainOrders: 0, items: [] };
  const orders = await recentOrderLines(product.client_id, days);
  const linked = new Set(parseUpsellIds(product.quote_json));
  const result = coPurchases(orders, mainSkus);
  const items: UpsellSuggestion[] = [];
  for (const item of result.items) {
    const matches = productBySku.get(item.sku.trim().toLowerCase()) ?? [];
    if (matches.some((row) => row.id === product.id || linked.has(row.id))) continue;
    const match = matches.find((row) => row.client_price != null) ?? matches[0] ?? null;
    // Several SKUs (variants) of one product: keep its most frequent line only.
    if (match && items.some((existing) => existing.product?.id === match.id)) continue;
    items.push({
      sku: item.sku,
      title: item.title,
      orders: item.orders,
      rate: result.mainOrders > 0 ? item.orders / result.mainOrders : 0,
      product: match,
    });
    if (items.length >= 12) break;
  }
  return { mainOrders: result.mainOrders, items };
}

/** Upsell id → titles of the products it is an upsell of (catalogue badges). */
export function upsellOwners(products: Array<Pick<ProductRow, "id" | "title" | "quote_json">>) {
  const owners = new Map<string, string[]>();
  for (const product of products) {
    for (const id of parseUpsellIds(product.quote_json)) {
      const list = owners.get(id) ?? [];
      list.push(product.title);
      owners.set(id, list);
    }
  }
  return owners;
}

/** Products of the same client that this product is an upsell of. */
export async function loadUpsellParents(product: ProductRow) {
  return upsellParentsOf(await clientProducts(product.client_id), product.id);
}
