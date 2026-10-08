/**
 * Pure mappings between Voltship records and ECCANG WMS payloads. No I/O so every
 * mapping is unit-tested with fixtures (see mapping.test.ts).
 */

import type { ProductRow } from "@/lib/products/types";

// --- Reference numbers ---------------------------------------------------------------

/** `VS-<client code>-<shopify order number>` (client code upper-cased, non [A-Z0-9] → "-"). */
export function orderReferenceNo(clientCode: string | null | undefined, orderNumber: number | string) {
  const code = (clientCode ?? "CLIENT").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `VS-${code}-${String(orderNumber).replace(/^#/, "")}`;
}

/** `VSIN-<client code>-<yyyymmdd>-<short id>` for ASNs created from a restock request. */
export function asnReferenceNo(clientCode: string | null | undefined, now = new Date(), nonce?: string) {
  const code = (clientCode ?? "CLIENT").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = (nonce ?? Math.random().toString(36).slice(2, 8)).toUpperCase();
  return `VSIN-${code}-${day}-${suffix}`;
}

// --- Shipping method mapping ---------------------------------------------------------

/** pricing_meta.eccang_shipping_methods: {"YunExpress|CHC": "YE_CHC", "YunExpress": "YE_STD"} */
export type ShippingMethodMap = Record<string, string>;

export function shippingMethodKey(carrier: string, lineName?: string | null) {
  const c = carrier.trim();
  const l = lineName?.trim();
  return l ? `${c}|${l}` : c;
}

export function parseShippingMethodMap(raw: unknown): ShippingMethodMap {
  let source: unknown = raw;
  if (typeof raw === "string") {
    try {
      source = JSON.parse(raw);
    } catch {
      source = {};
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const out: ShippingMethodMap = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim() && key.trim()) out[key.trim()] = value.trim();
  }
  return out;
}

/** Exact carrier|line match first, then carrier-only fallback. Case-insensitive. */
export function resolveShippingMethod(
  map: ShippingMethodMap,
  carrier: string | null | undefined,
  lineName?: string | null,
) {
  if (!carrier) return null;
  const entries = Object.entries(map).map(([key, value]) => [key.toLowerCase(), value] as const);
  const lookup = (key: string) => entries.find(([k]) => k === key.toLowerCase())?.[1] ?? null;
  if (lineName) {
    const exact = lookup(shippingMethodKey(carrier, lineName));
    if (exact) return exact;
  }
  return lookup(shippingMethodKey(carrier));
}

// --- Products ------------------------------------------------------------------------

export type EccangProductPayload = {
  product_sku: string;
  reference_no?: string;
  product_title: string;
  product_title_en: string;
  product_weight: number;
  product_length: number;
  product_width: number;
  product_height: number;
  product_declared_value: number;
  product_declared_name: string;
  product_declared_name_zh?: string;
  hs_code?: string;
  contain_battery?: 0 | 1;
  cat_lang: "en";
  verify: 1;
};

function quoteString(product: ProductRow, key: string) {
  const value = product.quote_json?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function quoteNumber(product: ProductRow, key: string) {
  const value = Number(product.quote_json?.[key]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * createProduct / modifyProduct params. Weight in KG, dimensions in CM, declared value in USD.
 * Declared names come from quote_json (declared_name_en / declared_name_zh, set by the
 * Airtable mapping when available) and fall back to the title. Dimensions default to a
 * 10×10×5 cm box when unknown — ECCANG requires them and the warehouse re-measures.
 */
export function mapProductToEccang(product: ProductRow): EccangProductPayload {
  if (!product.sku?.trim()) throw new Error("Product has no SKU yet.");
  const title = product.title.trim().slice(0, 255);
  const declaredEn = (quoteString(product, "declared_name_en") ?? title).slice(0, 50);
  const declaredZh = quoteString(product, "declared_name_zh");
  const weightKg = Math.max(0.001, Math.round((product.weight_g ?? 0)) / 1000);
  const declaredValue =
    quoteNumber(product, "declared_value_usd") ??
    (product.client_price != null && Number(product.client_price) > 0
      ? Math.round(Number(product.client_price) * 100) / 100
      : 1);
  const payload: EccangProductPayload = {
    product_sku: product.sku.trim(),
    reference_no: product.id,
    product_title: title,
    product_title_en: title,
    product_weight: weightKg,
    product_length: quoteNumber(product, "length_cm") ?? 10,
    product_width: quoteNumber(product, "width_cm") ?? 10,
    product_height: quoteNumber(product, "height_cm") ?? 5,
    product_declared_value: declaredValue,
    product_declared_name: declaredEn,
    cat_lang: "en",
    verify: 1,
  };
  if (declaredZh) payload.product_declared_name_zh = declaredZh.slice(0, 255);
  const hs = quoteString(product, "hs_code");
  if (hs) payload.hs_code = hs.slice(0, 32);
  if (product.shipping_channel === "electronics_battery") payload.contain_battery = 1;
  return payload;
}

/** ECCANG "product already exists" signals → fall back to modifyProduct. */
export function isProductExistsError(errCode: string | null, message: string | null) {
  const text = `${errCode ?? ""} ${message ?? ""}`.toLowerCase();
  return (
    text.includes("exist") ||
    text.includes("已存在") ||
    text.includes("duplicate") ||
    text.includes("重复")
  );
}

// --- Inventory → stock_cache ---------------------------------------------------------

export type EccangInventoryRow = {
  product_sku?: string;
  warehouse_code?: string;
  sellable?: string | number;
  reserved?: string | number;
  onway?: string | number;
  pending?: string | number;
  unsellable?: string | number;
  pi_update_time?: string;
};

export type StockCacheUpsert = {
  client_id: string;
  sku: string;
  qty_available: number;
  qty_reserved: number;
  inbound_qty: number;
  last_synced_at: string;
};

function int(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

/**
 * getProductInventory rows → stock_cache rows. `sellable` → qty_available,
 * `reserved` (待出库) → qty_reserved, `onway + pending` (在途 + 待上架) → inbound_qty.
 * Several rows for the same SKU (batches / warehouses) are summed.
 */
export function mapInventoryToStock(
  clientId: string,
  rows: EccangInventoryRow[],
  options: { warehouseCode?: string | null; now?: Date } = {},
): StockCacheUpsert[] {
  const now = (options.now ?? new Date()).toISOString();
  const bySku = new Map<string, StockCacheUpsert>();
  for (const row of rows) {
    const sku = row.product_sku?.trim();
    if (!sku) continue;
    if (options.warehouseCode && row.warehouse_code && row.warehouse_code !== options.warehouseCode) {
      continue;
    }
    const current = bySku.get(sku) ?? {
      client_id: clientId,
      sku,
      qty_available: 0,
      qty_reserved: 0,
      inbound_qty: 0,
      last_synced_at: now,
    };
    current.qty_available += int(row.sellable);
    current.qty_reserved += int(row.reserved);
    current.inbound_qty += int(row.onway) + int(row.pending);
    bySku.set(sku, current);
  }
  return [...bySku.values()];
}

// --- Orders --------------------------------------------------------------------------

export type ShopifyAddress = {
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  province_code?: string | null;
  zip?: string | null;
  country_code?: string | null;
  country?: string | null;
  phone?: string | null;
};

export type ShopifyOrderForEccang = {
  id: number | string;
  order_number?: number | string | null;
  name?: string | null;
  email?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  currency?: string | null;
  total_price?: string | number | null;
  shipping_address?: ShopifyAddress | null;
  line_items: Array<{
    sku: string | null;
    quantity: number;
    title?: string | null;
    name?: string | null;
    price?: string | number | null;
    requires_shipping?: boolean | null;
  }>;
};

export type EccangOrderItem = {
  product_sku: string;
  quantity: number;
  product_name_en?: string;
  product_declared_value?: number;
};

export type EccangCreateOrderPayload = {
  reference_no: string;
  platform: "OTHER";
  shipping_method: string;
  warehouse_code: string;
  country_code: string;
  province?: string;
  city: string;
  address1: string;
  address2?: string;
  zipcode: string;
  company?: string;
  name: string;
  phone: string;
  email?: string;
  platform_shop?: string;
  order_sale_amount?: number;
  order_sale_currency?: string;
  order_desc?: string;
  verify: 1;
  items: EccangOrderItem[];
};

export function orderNumberOf(order: Pick<ShopifyOrderForEccang, "id" | "order_number" | "name">) {
  if (order.order_number != null && String(order.order_number).trim()) return String(order.order_number);
  if (order.name?.trim()) return order.name.trim().replace(/^#/, "");
  return String(order.id);
}

/** Shippable line items with a SKU, same-SKU lines merged. */
export function orderLinesForEccang(order: ShopifyOrderForEccang) {
  const merged = new Map<string, EccangOrderItem>();
  for (const line of order.line_items) {
    if (line.requires_shipping === false) continue;
    const sku = line.sku?.trim();
    if (!sku || !(line.quantity > 0)) continue;
    const current = merged.get(sku);
    if (current) {
      current.quantity += line.quantity;
      continue;
    }
    const item: EccangOrderItem = { product_sku: sku, quantity: line.quantity };
    const title = (line.title ?? line.name ?? "").trim();
    if (title) item.product_name_en = title.slice(0, 200);
    const price = Number(line.price);
    if (Number.isFinite(price) && price > 0) item.product_declared_value = price;
    merged.set(sku, item);
  }
  return [...merged.values()];
}

/** Lines without a SKU (cannot be pushed) — used for the "SKU inconnu" notification. */
export function orderLinesWithoutSku(order: ShopifyOrderForEccang) {
  return order.line_items
    .filter((line) => line.requires_shipping !== false && !line.sku?.trim())
    .map((line) => (line.title ?? line.name ?? "?").trim());
}

/** Shopify order → createOrder params. Throws when the consignee is incomplete. */
export function mapShopifyOrderToEccang(
  order: ShopifyOrderForEccang,
  input: {
    referenceNo: string;
    warehouseCode: string;
    shippingMethod: string;
    shopDomain?: string | null;
  },
): EccangCreateOrderPayload {
  const address = order.shipping_address;
  if (!address) throw new Error("Order has no shipping address.");
  const country = (address.country_code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("Order has no ISO country code.");
  const name =
    (address.name ?? "").trim() ||
    [address.first_name, address.last_name].filter(Boolean).join(" ").trim();
  if (!name) throw new Error("Order has no consignee name.");
  const address1 = (address.address1 ?? "").trim();
  if (!address1) throw new Error("Order has no street address.");
  const items = orderLinesForEccang(order);
  if (items.length === 0) throw new Error("Order has no shippable line with a SKU.");
  const phone = (address.phone ?? order.phone ?? "").trim() || "0000000000";
  const email = (order.email ?? order.contact_email ?? "").trim();
  const total = Number(order.total_price);

  const payload: EccangCreateOrderPayload = {
    reference_no: input.referenceNo,
    platform: "OTHER",
    shipping_method: input.shippingMethod,
    warehouse_code: input.warehouseCode,
    country_code: country,
    city: (address.city ?? "").trim().slice(0, 128) || "-",
    address1: address1.slice(0, 500),
    zipcode: (address.zip ?? "").trim().slice(0, 32),
    name: name.slice(0, 128),
    phone: phone.slice(0, 64),
    verify: 1,
    items,
  };
  const province = (address.province_code ?? address.province ?? "").trim();
  if (province) payload.province = province.slice(0, 128);
  const address2 = (address.address2 ?? "").trim();
  if (address2) payload.address2 = address2.slice(0, 216);
  const company = (address.company ?? "").trim();
  if (company) payload.company = company.slice(0, 128);
  if (email) payload.email = email.slice(0, 64);
  if (input.shopDomain) payload.platform_shop = input.shopDomain.slice(0, 128);
  if (Number.isFinite(total) && total > 0) {
    payload.order_sale_amount = total;
    if (order.currency) payload.order_sale_currency = order.currency.toUpperCase().slice(0, 8);
  }
  const shopifyName = order.name?.trim();
  if (shopifyName) payload.order_desc = `Shopify ${shopifyName}`.slice(0, 512);
  return payload;
}

// --- Order status → eccang_orders ----------------------------------------------------

export type EccangOrderRecord = {
  order_code?: string;
  reference_no?: string;
  order_status?: string | { [key: string]: unknown };
  shipping_method?: string;
  tracking_no?: string;
  carrier_name?: string;
  courier_name?: string;
  warehouse_code?: string;
  order_weight?: string | number;
  date_shipping?: string | null;
  fee_details?: Record<string, unknown> | null;
  fee_items?: Array<{ ft_code?: string; amount?: string | number; currency_code?: string }> | null;
  sub_status?: string;
  abnormal_reason?: string;
};

export const ECCANG_ORDER_STATUS: Record<string, string> = {
  C: "awaiting_review",
  W: "awaiting_shipment",
  D: "shipped",
  H: "held",
  N: "abnormal",
  P: "problem",
  X: "cancelled",
};

export function normalizeOrderStatus(raw: unknown) {
  if (typeof raw === "string") return raw.trim().toUpperCase().slice(0, 1) || "pending";
  if (raw && typeof raw === "object") {
    const value = Object.values(raw as Record<string, unknown>)[0];
    if (typeof value === "string") return value.trim().toUpperCase().slice(0, 1) || "pending";
  }
  return "pending";
}

/** ECCANG `order_weight` is in KG → integer grams (billed weight). */
export function billedWeightG(raw: unknown) {
  const kg = Number(raw);
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return Math.round(kg * 1000);
}

export function mapOrderStatusToRow(record: EccangOrderRecord, now = new Date()) {
  const status = normalizeOrderStatus(record.order_status);
  const tracking = record.tracking_no?.trim() || null;
  const carrier = (record.carrier_name ?? record.courier_name ?? "").trim() || null;
  const shippedAt = record.date_shipping?.trim()
    ? new Date(record.date_shipping.replace(" ", "T") + (record.date_shipping.includes("T") ? "" : "Z"))
    : null;
  const fee =
    record.fee_details || record.fee_items
      ? { details: record.fee_details ?? null, items: record.fee_items ?? null }
      : null;
  return {
    eccang_order_code: record.order_code?.trim() || null,
    status,
    tracking_no: tracking,
    carrier_code: carrier,
    shipping_method: record.shipping_method?.trim() || null,
    billed_weight_g: billedWeightG(record.order_weight),
    fee_json: fee,
    last_payload: record as unknown as Record<string, unknown>,
    shipped_at:
      status === "D" ? (shippedAt && !Number.isNaN(shippedAt.getTime()) ? shippedAt : now).toISOString() : null,
    error: status === "N" || status === "P" ? record.abnormal_reason?.trim() || status : null,
    updated_at: now.toISOString(),
  };
}

// --- Orders created outside Voltship (client's own ECCANG API key / ECCANG UI) ----------

/** Our pushed orders all carry `VS-<code>-<n>`; anything else was created by the client. */
export function isVoltshipOrderReference(referenceNo: string | null | undefined) {
  return /^VS-/i.test((referenceNo ?? "").trim());
}

/** Key used in eccang_orders.reference_no for external orders (order_code is unique in ECCANG). */
export function externalOrderKey(orderCode: string) {
  return `ECC-${orderCode.trim()}`;
}

type EccangOrderItemLike = {
  product_sku?: string;
  sku?: string;
  quantity?: string | number;
  qty?: string | number;
  op_quantity?: string | number;
};

/** Order lines from a getOrderList / getOrderByRefCode detail (items | order_product | product). */
export function eccangOrderItems(record: Record<string, unknown>) {
  const source = [record.items, record.order_product, record.product, record.order_details].find(Array.isArray) as
    | EccangOrderItemLike[]
    | undefined;
  const bySku = new Map<string, number>();
  for (const item of source ?? []) {
    const sku = (item.product_sku ?? item.sku ?? "").trim();
    if (!sku) continue;
    const qty = int(item.quantity ?? item.qty ?? item.op_quantity);
    bySku.set(sku, (bySku.get(sku) ?? 0) + Math.max(1, qty));
  }
  return [...bySku.entries()].map(([sku, quantity]) => ({ sku, quantity }));
}

function eccangDate(value: unknown) {
  return typeof value === "string" ? dateOrNull(value) : null;
}

/**
 * ECCANG order the client created himself (no VS- reference) → eccang_orders row with
 * source "external" so it shows in the app and is billed like our own orders.
 */
export function mapExternalOrderToRow(clientId: string, record: EccangOrderRecord, now = new Date()) {
  const orderCode = record.order_code?.trim();
  if (!orderCode) return null;
  const raw = record as unknown as Record<string, unknown>;
  return {
    client_id: clientId,
    reference_no: externalOrderKey(orderCode),
    external_ref: record.reference_no?.trim() || null,
    source: "external" as const,
    items_json: eccangOrderItems(raw),
    eccang_created_at:
      eccangDate(raw.date_create) ?? eccangDate(raw.add_time) ?? null,
    ...mapOrderStatusToRow(record, now),
  };
}

// --- ASN → inbound_cache -------------------------------------------------------------

export type EccangAsnRecord = {
  receiving_code?: string;
  reference_no?: string;
  receiving_status?: string;
  tracking_number?: string;
  eta_date?: string | null;
  warehouse_receiving_time?: string | null;
  warehouse_receiving_complete_time?: string | null;
  warehouse_shelf_time?: string | null;
  sku_total?: string | number;
  items?: Array<{
    product_sku?: string;
    quantity?: string | number;
    received_quantity?: string | number;
    putaway_qty?: string | number;
    putaway_quantity?: string | number;
  }> | null;
};

export type InboundStatus = "announced" | "arrived" | "qc_in_progress" | "stocked";

/**
 * C new, W first-leg in transit → announced · P/T/Z/G receiving → arrived ·
 * F receiving complete → qc_in_progress (contrôlé / en rayon) · E put away → stocked ·
 * X cancelled → announced + cancelled flag.
 */
export function mapAsnStatus(raw: string | null | undefined): { status: InboundStatus; cancelled: boolean } {
  const code = (raw ?? "").trim().toUpperCase().slice(0, 1);
  switch (code) {
    case "E":
      return { status: "stocked", cancelled: false };
    case "F":
      return { status: "qc_in_progress", cancelled: false };
    case "P":
    case "T":
    case "Z":
    case "G":
      return { status: "arrived", cancelled: false };
    case "X":
      return { status: "announced", cancelled: true };
    default:
      return { status: "announced", cancelled: false };
  }
}

function dateOrNull(value: string | null | undefined) {
  if (!value?.trim() || value.startsWith("0000")) return null;
  const iso = value.trim().replace(" ", "T");
  const parsed = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso.endsWith("Z") ? iso : `${iso}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function mapAsnToInbound(clientId: string, asn: EccangAsnRecord, now = new Date()) {
  const { status, cancelled } = mapAsnStatus(asn.receiving_status);
  const items = (asn.items ?? [])
    .filter((item) => item.product_sku?.trim())
    .map((item) => ({
      sku: item.product_sku!.trim(),
      qty: int(item.quantity),
      received: int(item.received_quantity),
      putaway: int(item.putaway_qty ?? item.putaway_quantity),
    }));
  const announced = items.reduce((sum, item) => sum + item.qty, 0) || int(asn.sku_total) || null;
  const received = items.reduce((sum, item) => sum + item.received, 0);
  return {
    client_id: clientId,
    reference_no: asn.reference_no?.trim() || asn.receiving_code?.trim() || null,
    eccang_asn_code: asn.receiving_code?.trim() || null,
    eccang_ref: asn.receiving_code?.trim() || null,
    eccang_status: (asn.receiving_status ?? "").trim().toUpperCase().slice(0, 1) || null,
    status,
    cancelled,
    qty_announced: announced,
    qty_received: received > 0 ? received : null,
    items_json: items,
    tracking_no: asn.tracking_number?.trim() || null,
    eta: asn.eta_date?.trim() && !asn.eta_date.startsWith("0000") ? asn.eta_date.trim().slice(0, 10) : null,
    expected_at: dateOrNull(asn.eta_date),
    received_at: dateOrNull(asn.warehouse_receiving_complete_time) ?? dateOrNull(asn.warehouse_receiving_time),
    putaway_at: dateOrNull(asn.warehouse_shelf_time),
    last_payload: asn as unknown as Record<string, unknown>,
    updated_at: now.toISOString(),
  };
}

// --- Callback payload ----------------------------------------------------------------

export type EccangCallback = {
  appKey: string | null;
  msgId: string | null;
  type: "order" | "receiving" | "stock" | "unknown";
  body: Record<string, unknown>;
};

export function parseCallback(payload: unknown): EccangCallback {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const bodyRaw = record.body;
  const body =
    bodyRaw && typeof bodyRaw === "object"
      ? (bodyRaw as Record<string, unknown>)
      : typeof bodyRaw === "string"
        ? safeJsonObject(bodyRaw)
        : record;
  const rawType = String(record.subscript_type ?? record.type ?? "").toLowerCase();
  const type =
    rawType === "order" || rawType === "receiving" || rawType === "stock"
      ? rawType
      : body.order_code || body.reference_no && !body.receiving_code && !body.product_sku
        ? "order"
        : body.receiving_code
          ? "receiving"
          : body.product_sku
            ? "stock"
            : "unknown";
  const appKey = String(record.app_key ?? record.appKey ?? body.app_key ?? "").trim() || null;
  const msgId = String(record.msg_id ?? record.msgId ?? "").trim() || null;
  return { appKey, msgId, type, body };
}

function safeJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
