import "server-only";

import { unstable_cache } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildTodo,
  rankLinkCandidates,
  type ShopifyVariantLite,
  type TodoItem,
  type VoltshipProductLite,
} from "@/lib/products/todo-core";

export type TodoLinkCandidate = { id: string; title: string; sku: string | null; score: number };

export type ProductTodo = {
  items: Array<TodoItem & { clientName: string; shopDomain: string; candidates: TodoLinkCandidate[] }>;
  required: number;
  optional: number;
};

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null }>) {
  const rows: T[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data } = await fetchPage(from, from + 999);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/** Every active Shopify product (connected shops) still missing Voltship data. */
export async function loadProductTodo(options: { clientId?: string } = {}): Promise<ProductTodo> {
  const admin = createAdminClient();
  const { data: shops } = await admin
    .from("shops")
    .select("id, client_id, shopify_domain, clients!inner(name)")
    .eq("status", "active");
  const shopRows = (shops ?? []).filter((shop) => !options.clientId || shop.client_id === options.clientId);
  if (shopRows.length === 0) return { items: [], required: 0, optional: 0 };
  const shopIds = shopRows.map((shop) => shop.id as string);
  const clientIds = [...new Set(shopRows.map((shop) => shop.client_id as string))];

  const variants = await pageAll<ShopifyVariantLite & { status?: string | null }>((from, to) =>
    admin
      .from("shopify_products_cache")
      .select("id, client_id, shop_id, shopify_product_id, title, sku, photo_url, units_90d, imported_product_id, status")
      .in("shop_id", shopIds)
      .order("id")
      .range(from, to),
  );
  const activeVariants = variants.filter((variant) => !variant.status || variant.status === "active");

  const products = await pageAll<{
    id: string;
    client_id: string;
    title: string;
    sku: string | null;
    airtable_record_id: string;
    weight_g: number | null;
    client_price: number | null;
    shipping_channel: string | null;
  }>((from, to) =>
    admin
      .from("products_cache")
      .select("id, client_id, title, sku, airtable_record_id, weight_g, client_price, shipping_channel")
      .in("client_id", clientIds)
      .order("id")
      .range(from, to),
  );
  const productIds = products.map((product) => product.id);
  const factory = new Map<string, number | null>();
  for (let i = 0; i < productIds.length; i += 300) {
    const { data } = await admin
      .from("sourcing_work")
      .select("product_id, factory_purchase_price")
      .in("product_id", productIds.slice(i, i + 300));
    for (const row of data ?? []) factory.set(row.product_id, row.factory_purchase_price);
  }
  const maps = await pageAll<{ client_id: string; shopify_sku: string; airtable_record_id: string }>((from, to) =>
    admin
      .from("sku_maps")
      .select("client_id, shopify_sku, airtable_record_id")
      .in("client_id", clientIds)
      .order("shopify_sku")
      .range(from, to),
  );
  const mappedByRecord = new Map<string, string[]>();
  for (const row of maps) {
    const key = `${row.client_id}|${row.airtable_record_id}`;
    mappedByRecord.set(key, [...(mappedByRecord.get(key) ?? []), row.shopify_sku]);
  }
  const lite: VoltshipProductLite[] = products.map((product) => ({
    id: product.id,
    client_id: product.client_id,
    title: product.title,
    sku: product.sku,
    weight_g: product.weight_g,
    client_price: product.client_price,
    shipping_channel: product.shipping_channel,
    factory_purchase_price: factory.get(product.id) ?? null,
    mapped_skus: mappedByRecord.get(`${product.client_id}|${product.airtable_record_id}`) ?? [],
  }));

  const todo = buildTodo(activeVariants, lite);
  // Voltship products already linked to some Shopify product are not offered as link targets.
  const linked = new Set<string>();
  for (const item of buildTodo(activeVariants, lite.map((p) => ({ ...p, weight_g: null })))) {
    if (item.productId) linked.add(item.productId);
  }
  const shopById = new Map(shopRows.map((shop) => [shop.id as string, shop]));
  const items = todo.map((item) => {
    const shop = shopById.get(item.shopId);
    const client = shop ? (Array.isArray(shop.clients) ? shop.clients[0] : shop.clients) : null;
    const candidates = item.productId
      ? []
      : rankLinkCandidates(
          item.title,
          products
            .filter((product) => product.client_id === item.clientId && !linked.has(product.id))
            .map((product) => ({ id: product.id, title: product.title, sku: product.sku })),
        ).slice(0, 30);
    return {
      ...item,
      clientName: (client as { name?: string } | null)?.name ?? "?",
      shopDomain: (shop?.shopify_domain as string | undefined) ?? "",
      candidates,
    };
  });
  return {
    items,
    required: items.filter((item) => item.priority === "required").length,
    optional: items.filter((item) => item.priority === "optional").length,
  };
}

/** Count for the admin nav badge (cached 5 min — the list itself is always live). */
export const countRequiredTodo = unstable_cache(
  async () => {
    try {
      return (await loadProductTodo()).required;
    } catch {
      return 0;
    }
  },
  ["admin-todo-required"],
  { revalidate: 300, tags: ["admin-todo"] },
);
