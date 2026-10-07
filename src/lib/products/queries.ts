import { createAdminClient } from "@/lib/supabase/admin";
import type { ProductRow } from "@/lib/products/types";
import { countOrderWindows } from "@/lib/domain/orders-shipped";
import { calculateSafetyStock, type StockStatus } from "@/lib/domain/safety-stock";
import { unpackOrderLines } from "@/lib/shopify/order-cache";
import { loadProductSkus } from "@/lib/products/skus";
import {
  CLIENT_PRODUCT_SELECT,
  serializeClientProduct,
} from "@/lib/products/visibility";

export async function listTenantProducts(clientId: string, shopId?: string | null) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products_cache")
    .select(CLIENT_PRODUCT_SELECT)
    .eq("client_id", clientId)
    .neq("lifecycle_status", "archived")
    .order("created_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  const products = (data ?? []).map((row) => serializeClientProduct(row));
  if (!shopId) return products;
  // One store selected: only the products imported from (or mapped to) that store.
  const [{ data: imported }, { data: mapped }] = await Promise.all([
    admin
      .from("shopify_products_cache")
      .select("imported_product_id")
      .eq("client_id", clientId)
      .eq("shop_id", shopId)
      .not("imported_product_id", "is", null),
    admin
      .from("sku_maps")
      .select("airtable_record_id")
      .eq("client_id", clientId)
      .eq("shop_id", shopId),
  ]);
  const ids = new Set((imported ?? []).map((row) => row.imported_product_id as string));
  const records = new Set((mapped ?? []).map((row) => row.airtable_record_id));
  return products.filter(
    (product) => ids.has(product.id) || records.has(product.airtable_record_id),
  );
}

export async function getTenantProduct(clientId: string, productId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products_cache")
    .select(CLIENT_PRODUCT_SELECT)
    .eq("client_id", clientId)
    .eq("id", productId)
    .maybeSingle();

  if (error) throw error;
  return data ? serializeClientProduct(data) : null;
}

export async function sumOrdersShipped(clientId: string, shopId?: string | null) {
  const admin = createAdminClient();
  const since = new Date();
  since.setDate(since.getDate() - 29);
  const sinceDate = since.toISOString().slice(0, 10);
  const data: Array<{ order_date: string; cancelled: boolean; line_items_json: unknown }> = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await admin
      .from("shopify_orders_cache")
      .select("order_date, cancelled, line_items_json")
      .eq("client_id", clientId)
      .match(shopId ? { shop_id: shopId } : {})
      .gte("order_date", sinceDate)
      .order("order_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    data.push(...(page ?? []));
    if (!page || page.length < pageSize) break;
  }
  const rows = data.map((row) => ({
    date: String(row.order_date),
    cancelled: Boolean(row.cancelled),
    fulfilled: unpackOrderLines(row.line_items_json).fulfilled,
  }));
  const fulfilled = rows.filter((row) => row.fulfilled === true && !row.cancelled);
  const counted = fulfilled.length > 0 ? fulfilled : rows.filter((row) => !row.cancelled);
  return {
    ...countOrderWindows(counted.map((row) => row.date)),
    source: fulfilled.length > 0 ? ("fulfilled" as const) : ("placed" as const),
  };
}

export type RestockAlert = {
  product: ProductRow;
  clientName?: string;
  status: StockStatus;
  daysLeft: number | null;
  suggestedQty: number;
  stockoutSince: string | null;
  lostUnits: number | null;
};

export async function listRestockAlerts(clientId: string, products: ProductRow[]) {
  const admin = createAdminClient();
  const productSkus = await loadProductSkus(products);
  const skus = [...new Set([...productSkus.values()].flat())];
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const recentSince = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [{ data: sales }, { data: stock }, { data: client }] = await Promise.all([
    skus.length === 0
      ? Promise.resolve({ data: [] as Array<{ sku: string; units_sold: number; date: string }> })
      : admin
          .from("sales_cache")
          .select("sku, units_sold, date")
          .eq("client_id", clientId)
          .in("sku", skus)
          .gte("date", since),
    skus.length === 0
      ? Promise.resolve({
          data: [] as Array<{
            sku: string;
            qty_available: number;
            qty_reserved: number;
            inbound_qty: number;
          }>,
        })
      : admin
          .from("stock_cache")
          .select("sku, qty_available, qty_reserved, inbound_qty")
          .eq("client_id", clientId)
          .in("sku", skus),
    admin
      .from("clients")
      .select("safety_buffer_days, coverage_target_days")
      .eq("id", clientId)
      .maybeSingle(),
  ]);

  const units = new Map<string, number>();
  const lastSale = new Map<string, string>();
  for (const row of sales ?? []) {
    const sold = Number(row.units_sold);
    if (row.date >= recentSince) {
      units.set(row.sku, (units.get(row.sku) ?? 0) + sold);
    }
    if (sold > 0 && row.date > (lastSale.get(row.sku) ?? "")) {
      lastSale.set(row.sku, row.date);
    }
  }
  const stockBySku = new Map((stock ?? []).map((row) => [row.sku, row]));
  const alerts: RestockAlert[] = [];

  for (const product of products) {
    const own = productSkus.get(product.id) ?? [];
    const cached = own.map((sku) => stockBySku.get(sku)).find(Boolean);
    const tracked =
      product.sourcing_status === "in_stock" ||
      product.lifecycle_status === "winning" ||
      product.lifecycle_status === "declining" ||
      product.lifecycle_status === "dead" ||
      (product.stock_manual ?? 0) > 0 ||
      cached != null;
    if (!tracked) continue;

    const salesPerDay = own.reduce((sum, sku) => sum + (units.get(sku) ?? 0), 0) / 30;
    const result = calculateSafetyStock({
      qtyAvailable: cached?.qty_available ?? product.stock_manual ?? 0,
      qtyReserved: cached?.qty_reserved ?? 0,
      inboundQty: cached?.inbound_qty ?? 0,
      salesPerDay,
      productionLeadDays: product.production_lead_days,
      bufferDays: client?.safety_buffer_days ?? 7,
      coverageTargetDays: client?.coverage_target_days ?? 60,
      moq: product.moq,
    });
    if (result.status === "ok") continue;
    const sinceSale =
      own
        .map((sku) => lastSale.get(sku))
        .filter((date): date is string => Boolean(date))
        .sort()
        .at(-1) ?? null;
    const stockout =
      result.status === "out_of_stock" && sinceSale
        ? stockoutFromLastSale(sinceSale, salesPerDay)
        : { stockoutSince: null, lostUnits: null };
    alerts.push({
      product,
      status: result.status,
      daysLeft: result.daysLeft,
      suggestedQty: result.suggestedQty,
      ...stockout,
    });
  }

  return alerts.sort(
    (a, b) =>
      (a.daysLeft ?? Number.NEGATIVE_INFINITY) - (b.daysLeft ?? Number.NEGATIVE_INFINITY),
  );
}

function stockoutFromLastSale(lastSaleDate: string, salesPerDay: number) {
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(`${lastSaleDate}T00:00:00`).getTime()) / 86400000),
  );
  return {
    stockoutSince: lastSaleDate,
    lostUnits: Math.round(salesPerDay * days),
  };
}

export async function listStaffRestockAlerts() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products_cache")
    .select("*, clients!inner(name, safety_buffer_days, coverage_target_days)")
    .or("lifecycle_status.in.(winning,declining,dead),sourcing_status.eq.in_stock")
    .neq("lifecycle_status", "archived")
    .limit(300);
  if (error) throw error;

  const grouped = new Map<string, { name: string; products: ProductRow[] }>();
  for (const row of data ?? []) {
    const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
    const current = grouped.get(row.client_id) ?? {
      name: client?.name ?? "Client",
      products: [] as ProductRow[],
    };
    current.products.push(row as ProductRow);
    grouped.set(row.client_id, current);
  }

  const alerts: RestockAlert[] = [];
  for (const [clientId, group] of grouped) {
    const rows = await listRestockAlerts(clientId, group.products);
    alerts.push(...rows.map((alert) => ({ ...alert, clientName: group.name })));
  }
  return alerts.sort(
    (a, b) =>
      (a.daysLeft ?? Number.NEGATIVE_INFINITY) - (b.daysLeft ?? Number.NEGATIVE_INFINITY),
  );
}

export type ProductMetrics = {
  salesDay: number;
  /** Units sold over the last 24 hours (rolling, from Shopify order timestamps). */
  units24h: number;
  /** Rolling 7 days. */
  units7: number;
  units30: number;
  /** Units sold over the last 90 days (Shopify sales cache); null when the SKU has no sales rows. */
  units90: number | null;
  daysLeft: number | null;
  qtyAvailable: number;
  inboundQty: number;
};

export async function getTenantProductMetrics(
  clientId: string,
  products: ProductRow[],
) {
  const productSkus = await loadProductSkus(products);
  const skus = [...new Set([...productSkus.values()].flat())];
  const metrics = new Map<string, ProductMetrics>();
  if (skus.length === 0) return metrics;

  const admin = createAdminClient();
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const since90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const since30At = new Date(Date.now() - 30 * 86400000).toISOString();
  const [{ data: sales }, { data: stock }, { data: orders }] = await Promise.all([
    admin
      .from("sales_cache")
      .select("sku, units_sold, date")
      .eq("client_id", clientId)
      .in("sku", skus)
      .gte("date", since90),
    admin
      .from("stock_cache")
      .select("sku, qty_available, inbound_qty")
      .eq("client_id", clientId)
      .in("sku", skus),
    admin
      .from("shopify_orders_cache")
      .select("placed_at, order_date, cancelled, line_items_json")
      .eq("client_id", clientId)
      .gte("order_date", since30.slice(0, 10))
      .eq("cancelled", false),
  ]);
  // Rolling windows (24 h / 7 d / 30 d) from the exact order time; orders without a
  // timestamp fall back to their order date at midnight UTC.
  const skuSet = new Set(skus);
  const now = Date.now();
  const rolling24 = new Map<string, number>();
  const rolling7 = new Map<string, number>();
  const rolling30 = new Map<string, number>();
  let hasOrders = false;
  for (const order of orders ?? []) {
    const at = new Date(order.placed_at ?? `${order.order_date}T00:00:00Z`).getTime();
    if (!Number.isFinite(at) || at < Date.parse(since30At)) continue;
    const age = now - at;
    for (const line of unpackOrderLines(order.line_items_json).lines) {
      if (!skuSet.has(line.sku)) continue;
      hasOrders = true;
      const qty = Number(line.quantity) || 0;
      rolling30.set(line.sku, (rolling30.get(line.sku) ?? 0) + qty);
      if (age <= 7 * 86400000) rolling7.set(line.sku, (rolling7.get(line.sku) ?? 0) + qty);
      if (age <= 86400000) rolling24.set(line.sku, (rolling24.get(line.sku) ?? 0) + qty);
    }
  }
  const units7BySku = new Map<string, number>();
  const units30BySku = new Map<string, number>();
  const units90BySku = new Map<string, number>();
  for (const row of sales ?? []) {
    const sold = Number(row.units_sold);
    units90BySku.set(row.sku, (units90BySku.get(row.sku) ?? 0) + sold);
    if (row.date >= since7) {
      units7BySku.set(row.sku, (units7BySku.get(row.sku) ?? 0) + sold);
    }
    if (row.date >= since30) {
      units30BySku.set(row.sku, (units30BySku.get(row.sku) ?? 0) + sold);
    }
  }
  const stockBySku = new Map(
    (stock ?? []).map((row) => [
      row.sku,
      { available: Number(row.qty_available), inbound: Number(row.inbound_qty ?? 0) },
    ]),
  );
  for (const product of products) {
    const own = productSkus.get(product.id) ?? [];
    if (own.length === 0) continue;
    const units7 = own.reduce((sum, sku) => sum + (units7BySku.get(sku) ?? 0), 0);
    const units30 = own.reduce((sum, sku) => sum + (units30BySku.get(sku) ?? 0), 0);
    const hasSales = own.some((sku) => units90BySku.has(sku));
    const units90 = own.reduce((sum, sku) => sum + (units90BySku.get(sku) ?? 0), 0);
    const salesDay = units30 / 30;
    const cached = own.map((sku) => stockBySku.get(sku)).find(Boolean);
    const available = cached?.available ?? product.stock_manual ?? 0;
    const sumOwn = (map: Map<string, number>) =>
      own.reduce((sum, sku) => sum + (map.get(sku) ?? 0), 0);
    metrics.set(product.id, {
      units24h: sumOwn(rolling24),
      units7: hasOrders ? sumOwn(rolling7) : units7,
      units30: hasOrders ? sumOwn(rolling30) : units30,
      units90: hasSales ? units90 : null,
      salesDay,
      daysLeft: salesDay > 0 ? available / salesDay : null,
      qtyAvailable: available,
      inboundQty: cached?.inbound ?? 0,
    });
  }
  return metrics;
}

export async function getProductStockSnapshot(product: ProductRow) {
  const admin = createAdminClient();
  const ownSkus = (await loadProductSkus([product])).get(product.id) ?? [];
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const recentSince = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [{ data: sales }, { data: stock }, { data: client }] = await Promise.all([
    ownSkus.length > 0
      ? admin
          .from("sales_cache")
          .select("units_sold, date")
          .eq("client_id", product.client_id)
          .in("sku", ownSkus)
          .gte("date", since)
      : Promise.resolve({ data: [] as Array<{ units_sold: number; date: string }> }),
    product.sku
      ? admin
          .from("stock_cache")
          .select("qty_available, qty_reserved, inbound_qty")
          .eq("client_id", product.client_id)
          .eq("sku", product.sku)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("clients")
      .select("safety_buffer_days, coverage_target_days")
      .eq("id", product.client_id)
      .maybeSingle(),
  ]);
  let units30 = 0;
  let lastSale: string | null = null;
  for (const row of sales ?? []) {
    const sold = Number(row.units_sold);
    if (row.date >= recentSince) units30 += sold;
    if (sold > 0 && row.date > (lastSale ?? "")) lastSale = row.date;
  }
  const salesPerDay = units30 / 30;
  const qtyAvailable = stock?.qty_available ?? product.stock_manual ?? 0;
  const result = calculateSafetyStock({
    qtyAvailable,
    qtyReserved: stock?.qty_reserved ?? 0,
    inboundQty: stock?.inbound_qty ?? 0,
    salesPerDay,
    productionLeadDays: product.production_lead_days,
    bufferDays: client?.safety_buffer_days ?? 7,
    coverageTargetDays: client?.coverage_target_days ?? 60,
    moq: product.moq,
  });
  const stockout =
    result.status === "out_of_stock" && lastSale
      ? stockoutFromLastSale(lastSale, salesPerDay)
      : { stockoutSince: null, lostUnits: null };
  return {
    ...result,
    qtyAvailable,
    qtyReserved: stock?.qty_reserved ?? 0,
    inboundQty: stock?.inbound_qty ?? 0,
    salesPerDay,
    ...stockout,
  };
}
