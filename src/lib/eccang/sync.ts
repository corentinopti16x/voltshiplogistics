import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  callEccang,
  EccangApiError,
  getCredentialsForClient,
  isEccangConfigured,
  requireEccangClient,
  type ClientEccangConfig,
  type EccangCredentials,
} from "@/lib/eccang/client";
import {
  asnReferenceNo,
  isProductExistsError,
  mapAsnToInbound,
  mapInventoryToStock,
  mapOrderStatusToRow,
  mapProductToEccang,
  mapShopifyOrderToEccang,
  orderLinesForEccang,
  orderLinesWithoutSku,
  orderNumberOf,
  orderReferenceNo,
  parseShippingMethodMap,
  resolveShippingMethod,
  type EccangAsnRecord,
  type EccangInventoryRow,
  type EccangOrderRecord,
  type ShippingMethodMap,
  type ShopifyOrderForEccang,
} from "@/lib/eccang/mapping";
import { calculateProductCogsMatrix } from "@/lib/pricing/server";
import { createNotification } from "@/lib/notifications/server";
import { decryptShopifyToken } from "@/lib/shopify/crypto";
import { createFulfillmentForOrder } from "@/lib/shopify/admin-api";
import type { ProductRow } from "@/lib/products/types";

export const ECCANG_SHIPPING_METHODS_KEY = "eccang_shipping_methods";

/** Order statuses that still need polling (no tracking / not shipped yet). */
const OPEN_ORDER_STATUSES = ["pending", "C", "W", "H", "N", "P"];

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function notify(clientId: string, type: string, payload: Record<string, unknown>) {
  try {
    await createNotification({ clientId, type, payload, channels: ["in_app"] });
  } catch {
    // Best-effort.
  }
}

// --- Settings ------------------------------------------------------------------------

export async function getShippingMethodMap(): Promise<ShippingMethodMap> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("pricing_meta")
    .select("value")
    .eq("key", ECCANG_SHIPPING_METHODS_KEY)
    .maybeSingle();
  return parseShippingMethodMap(data?.value);
}

export async function saveShippingMethodMap(map: ShippingMethodMap) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("pricing_meta")
    .upsert({ key: ECCANG_SHIPPING_METHODS_KEY, value: JSON.stringify(map) }, { onConflict: "key" });
  if (error) throw error;
}

/** True when the client has the flag on, credentials and a warehouse — the gate for every hook. */
export async function isEccangActive(clientId: string) {
  if (!isEccangConfigured()) return { active: false as const, config: null };
  try {
    const config = await getCredentialsForClient(clientId);
    const active = config.enabled && Boolean(config.credentials) && Boolean(config.warehouseCode);
    return { active, config };
  } catch {
    return { active: false as const, config: null };
  }
}

// --- Products ------------------------------------------------------------------------

type EccangStamp = {
  pushed_at: string;
  sku: string;
  action: "createProduct" | "modifyProduct";
  error?: string | null;
};

async function stampProduct(product: ProductRow, stamp: Partial<EccangStamp> & { error?: string | null }) {
  const admin = createAdminClient();
  const quote = product.quote_json && typeof product.quote_json === "object" ? { ...product.quote_json } : {};
  const previous = (quote._eccang && typeof quote._eccang === "object" ? quote._eccang : {}) as Record<string, unknown>;
  await admin
    .from("products_cache")
    .update({ quote_json: { ...quote, _eccang: { ...previous, ...stamp } } })
    .eq("id", product.id)
    .eq("client_id", product.client_id);
}

/**
 * createProduct (verify=1), falling back to modifyProduct when the SKU already exists.
 * Stores the result on products_cache.quote_json._eccang {pushed_at, sku, action, error}.
 */
export async function pushProduct(clientId: string, product: ProductRow, config?: ClientEccangConfig) {
  const cfg = config ?? (await getCredentialsForClient(clientId));
  const { credentials } = requireEccangClient(cfg);
  const payload = mapProductToEccang(product);
  let action: EccangStamp["action"] = "createProduct";
  try {
    try {
      await callEccang(credentials, "createProduct", payload);
    } catch (error) {
      if (error instanceof EccangApiError && isProductExistsError(error.errCode, error.errMessage)) {
        action = "modifyProduct";
        await callEccang(credentials, "modifyProduct", payload);
      } else {
        throw error;
      }
    }
  } catch (error) {
    const message = errorText(error, "ECCANG product push failed.");
    await stampProduct(product, { sku: payload.product_sku, error: message });
    throw error;
  }
  await stampProduct(product, {
    pushed_at: new Date().toISOString(),
    sku: payload.product_sku,
    action,
    error: null,
  });
  return { action, sku: payload.product_sku };
}

/** Pushes every product with a SKU in validated / in_production / in_stock. */
export async function pushValidatedProducts(clientId: string) {
  const cfg = await getCredentialsForClient(clientId);
  requireEccangClient(cfg);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products_cache")
    .select("*")
    .eq("client_id", clientId)
    .in("sourcing_status", ["validated", "in_production", "in_stock"])
    .not("sku", "is", null)
    .returns<ProductRow[]>();
  if (error) throw error;
  const result = { pushed: 0, failed: [] as Array<{ sku: string; error: string }> };
  for (const product of data ?? []) {
    try {
      await pushProduct(clientId, product, cfg);
      result.pushed += 1;
    } catch (err) {
      result.failed.push({ sku: product.sku ?? product.id, error: errorText(err, "push failed") });
    }
  }
  return result;
}

/** Hook: called after a quote is accepted. Never throws (the accept already succeeded). */
export async function pushProductIfEnabled(clientId: string, product: ProductRow) {
  const { active, config } = await isEccangActive(clientId);
  if (!active || !config || !product.sku) return null;
  try {
    return await pushProduct(clientId, product, config);
  } catch {
    return null;
  }
}

// --- Inventory -----------------------------------------------------------------------

/** getProductInventory for the client's warehouse → stock_cache (feeds restock alerts). */
export async function pullInventory(clientId: string, config?: ClientEccangConfig) {
  const cfg = config ?? (await getCredentialsForClient(clientId));
  const { credentials, warehouseCode } = requireEccangClient(cfg);
  const rows: EccangInventoryRow[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const response = await callEccang<EccangInventoryRow[]>(credentials, "getProductInventory", {
      page,
      pageSize: 500,
      warehouse_code: warehouseCode,
    });
    const data = Array.isArray(response.data) ? response.data : [];
    rows.push(...data);
    const next = String(response.nextPage ?? "false").toLowerCase() === "true";
    if (!next || data.length === 0) break;
  }
  const upserts = mapInventoryToStock(clientId, rows, { warehouseCode });
  if (upserts.length > 0) {
    const admin = createAdminClient();
    const { error } = await admin.from("stock_cache").upsert(upserts, { onConflict: "client_id,sku" });
    if (error) throw error;
  }
  return { skus: upserts.length };
}

// --- Orders --------------------------------------------------------------------------

async function skuKnown(clientId: string, skus: string[]) {
  const admin = createAdminClient();
  const [{ data: maps }, { data: products }] = await Promise.all([
    admin.from("sku_maps").select("shopify_sku, eccang_sku").eq("client_id", clientId).in("shopify_sku", skus),
    admin.from("products_cache").select("sku").eq("client_id", clientId).in("sku", skus),
  ]);
  const known = new Set<string>();
  for (const row of maps ?? []) if (row.shopify_sku) known.add(row.shopify_sku);
  for (const row of products ?? []) if (row.sku) known.add(row.sku);
  return { known, unknown: skus.filter((sku) => !known.has(sku)) };
}

async function pickShippingMethod(clientId: string, order: ShopifyOrderForEccang, items: ReturnType<typeof orderLinesForEccang>) {
  const map = await getShippingMethodMap();
  const country = (order.shipping_address?.country_code ?? "").toUpperCase();
  const admin = createAdminClient();
  const { data: product } = await admin
    .from("products_cache")
    .select("*")
    .eq("client_id", clientId)
    .eq("sku", items[0].product_sku)
    .maybeSingle<ProductRow>();
  let carrier: string | null = null;
  let lineName: string | null = null;
  if (product && /^[A-Z]{2}$/.test(country)) {
    const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
    try {
      const matrix = await calculateProductCogsMatrix(product, {
        markets: [country],
        quantities: [quantity],
      });
      const breakdown = matrix.markets[0]?.cells[0]?.breakdown ?? null;
      carrier = breakdown?.carrier ?? null;
      lineName = breakdown?.lineName ?? null;
    } catch {
      carrier = null;
    }
  }
  const code =
    resolveShippingMethod(map, carrier, lineName) ??
    resolveShippingMethod(map, `default:${country}`) ??
    resolveShippingMethod(map, "default");
  return { code, carrier, lineName };
}

/**
 * Shopify order → createOrder. Reference `VS-<client code>-<order number>`. Idempotent on
 * the reference (an order already pushed is only re-polled). When a SKU is unknown or the
 * shipping method cannot be mapped the order is NOT pushed and the client gets an in-app
 * notification.
 */
export async function pushOrder(
  clientId: string,
  order: ShopifyOrderForEccang,
  shop: { id: string; domain: string },
  config?: ClientEccangConfig,
) {
  const cfg = config ?? (await getCredentialsForClient(clientId));
  const { credentials, warehouseCode } = requireEccangClient(cfg);
  const admin = createAdminClient();
  const orderNumber = orderNumberOf(order);
  const referenceNo = orderReferenceNo(cfg.clientCode, orderNumber);

  const { data: existing } = await admin
    .from("eccang_orders")
    .select("id, eccang_order_code, status")
    .eq("reference_no", referenceNo)
    .maybeSingle();
  if (existing?.eccang_order_code) {
    return { referenceNo, skipped: "already_pushed" as const };
  }

  const items = orderLinesForEccang(order);
  const missing = orderLinesWithoutSku(order);
  const { unknown } = items.length ? await skuKnown(clientId, items.map((item) => item.product_sku)) : { unknown: [] };
  if (items.length === 0 || unknown.length > 0 || missing.length > 0) {
    const detail = [...unknown, ...missing].join(", ") || "—";
    await notify(clientId, "eccang_order_blocked", {
      message: `Commande ${order.name ?? orderNumber} non poussée à l'entrepôt : SKU inconnu (${detail}).`,
      referenceNo,
      shopifyOrderId: String(order.id),
      unknownSkus: [...unknown, ...missing],
    });
    return { referenceNo, skipped: "unknown_sku" as const, unknown: [...unknown, ...missing] };
  }

  const method = await pickShippingMethod(clientId, order, items);
  if (!method.code) {
    const label = method.carrier ? `${method.carrier}${method.lineName ? ` · ${method.lineName}` : ""}` : "aucun transporteur";
    await admin.from("eccang_orders").upsert(
      {
        client_id: clientId,
        shop_id: shop.id,
        shopify_order_id: String(order.id),
        reference_no: referenceNo,
        status: "pending",
        error: `Aucune méthode d'expédition ECCANG pour ${label}.`,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "reference_no" },
    );
    await notify(clientId, "eccang_order_blocked", {
      message: `Commande ${order.name ?? orderNumber} non poussée : méthode d'expédition ECCANG non mappée (${label}).`,
      referenceNo,
      shopifyOrderId: String(order.id),
    });
    return { referenceNo, skipped: "no_shipping_method" as const };
  }

  const payload = mapShopifyOrderToEccang(order, {
    referenceNo,
    warehouseCode,
    shippingMethod: method.code,
    shopDomain: shop.domain,
  });
  const now = new Date().toISOString();
  try {
    const response = await callEccang<unknown>(credentials, "createOrder", payload);
    const orderCode = typeof response.order_code === "string" ? response.order_code : null;
    const tracking = typeof response.tracking_no === "string" && response.tracking_no.trim() ? response.tracking_no.trim() : null;
    const { error } = await admin.from("eccang_orders").upsert(
      {
        client_id: clientId,
        shop_id: shop.id,
        shopify_order_id: String(order.id),
        reference_no: referenceNo,
        eccang_order_code: orderCode,
        status: "C",
        tracking_no: tracking,
        shipping_method: method.code,
        carrier_code: method.carrier,
        error: null,
        pushed_at: now,
        updated_at: now,
      },
      { onConflict: "reference_no" },
    );
    if (error) throw error;
    return { referenceNo, orderCode, skipped: null };
  } catch (error) {
    const message = errorText(error, "ECCANG createOrder failed.");
    await admin.from("eccang_orders").upsert(
      {
        client_id: clientId,
        shop_id: shop.id,
        shopify_order_id: String(order.id),
        reference_no: referenceNo,
        status: "pending",
        shipping_method: method.code,
        error: message,
        updated_at: now,
      },
      { onConflict: "reference_no" },
    );
    throw error;
  }
}

/** Hook for the Shopify orders webhook. Never throws. */
export async function pushOrderIfEnabled(
  clientId: string,
  order: ShopifyOrderForEccang & { cancelled_at?: string | null },
  shop: { id: string; domain: string },
) {
  if (order.cancelled_at) return null;
  const { active, config } = await isEccangActive(clientId);
  if (!active || !config) return null;
  try {
    return await pushOrder(clientId, order, shop, config);
  } catch {
    return null;
  }
}

async function fulfilShopifyOrder(row: {
  shop_id: string | null;
  shopify_order_id: string | null;
  tracking_no: string | null;
  carrier_code: string | null;
}) {
  if (!row.shop_id || !row.shopify_order_id || !row.tracking_no) return false;
  const admin = createAdminClient();
  const { data: shop } = await admin
    .from("shops")
    .select("shopify_domain, access_token_encrypted, status")
    .eq("id", row.shop_id)
    .maybeSingle();
  if (!shop || shop.status !== "active" || !shop.access_token_encrypted) return false;
  const token = decryptShopifyToken(shop.access_token_encrypted);
  await createFulfillmentForOrder(shop.shopify_domain, token, row.shopify_order_id, {
    number: row.tracking_no,
    company: row.carrier_code,
  });
  return true;
}

/**
 * getOrderByRefCode → eccang_orders (status, tracking, carrier, order_weight → billed
 * weight, fees). When a tracking number appears and the shop is active, the Shopify
 * fulfillment is created once (fulfilled_at).
 */
export async function pullOrderStatus(clientId: string, referenceNo: string, config?: ClientEccangConfig) {
  const cfg = config ?? (await getCredentialsForClient(clientId));
  const { credentials } = requireEccangClient(cfg);
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("eccang_orders")
    .select("id, shop_id, shopify_order_id, tracking_no, carrier_code, fulfilled_at, status")
    .eq("client_id", clientId)
    .eq("reference_no", referenceNo)
    .maybeSingle();
  if (!row) throw new Error(`Unknown ECCANG order ${referenceNo}.`);

  const response = await callEccang<EccangOrderRecord | EccangOrderRecord[]>(
    credentials,
    "getOrderByRefCode",
    { reference_no: referenceNo },
  );
  const record = Array.isArray(response.data) ? response.data[0] : response.data;
  if (!record) throw new Error(`ECCANG returned no order for ${referenceNo}.`);
  const update = mapOrderStatusToRow(record);
  const { error } = await admin.from("eccang_orders").update(update).eq("id", row.id);
  if (error) throw error;

  let fulfilled = false;
  if (update.tracking_no && !row.fulfilled_at) {
    try {
      fulfilled = await fulfilShopifyOrder({
        shop_id: row.shop_id,
        shopify_order_id: row.shopify_order_id,
        tracking_no: update.tracking_no,
        carrier_code: update.carrier_code,
      });
      if (fulfilled) {
        await admin.from("eccang_orders").update({ fulfilled_at: new Date().toISOString() }).eq("id", row.id);
      }
    } catch (fulfilError) {
      await admin
        .from("eccang_orders")
        .update({ error: `Shopify: ${errorText(fulfilError, "fulfillment failed")}` })
        .eq("id", row.id);
    }
    if (!row.tracking_no) {
      await notify(clientId, "eccang_shipped", {
        message: `Commande ${referenceNo} expédiée · ${update.carrier_code ?? "transporteur"} ${update.tracking_no}.`,
        referenceNo,
        trackingNo: update.tracking_no,
      });
    }
  }
  return { status: update.status, trackingNo: update.tracking_no, fulfilled };
}

/** Polls every pushed order that has no tracking / is not shipped yet. */
export async function pullPendingOrders(clientId: string, config?: ClientEccangConfig) {
  const cfg = config ?? (await getCredentialsForClient(clientId));
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("eccang_orders")
    .select("reference_no, status, tracking_no")
    .eq("client_id", clientId)
    .not("eccang_order_code", "is", null)
    .or(`tracking_no.is.null,status.in.(${OPEN_ORDER_STATUSES.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(200);
  const result = { polled: 0, failed: 0 };
  for (const row of rows ?? []) {
    try {
      await pullOrderStatus(clientId, row.reference_no, cfg);
      result.polled += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

// --- ASN / inbound -------------------------------------------------------------------

async function upsertAsnRows(clientId: string, asns: EccangAsnRecord[]) {
  if (asns.length === 0) return 0;
  const admin = createAdminClient();
  const rows = asns.map((asn) => mapAsnToInbound(clientId, asn)).filter((row) => row.reference_no);
  if (rows.length === 0) return 0;
  // Keep product_id when we created the ASN ourselves (restock flow).
  const { error } = await admin
    .from("inbound_cache")
    .upsert(rows, { onConflict: "client_id,reference_no" });
  if (error) throw error;
  return rows.length;
}

/** getAsnList (last 180 days, modified) → inbound_cache. */
export async function pullAsn(clientId: string, config?: ClientEccangConfig, referenceNo?: string) {
  const cfg = config ?? (await getCredentialsForClient(clientId));
  const { credentials } = requireEccangClient(cfg);
  const asns: EccangAsnRecord[] = [];
  const since = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 19).replace("T", " ");
  for (let page = 1; page <= 25; page += 1) {
    const response = await callEccang<EccangAsnRecord[]>(credentials, "getAsnList", {
      page,
      pageSize: 20,
      ...(referenceNo ? { reference_no: referenceNo } : { create_date_from: since }),
    });
    const data = Array.isArray(response.data) ? response.data : [];
    asns.push(...data);
    const next = String(response.nextPage ?? "false").toLowerCase() === "true";
    if (!next || data.length === 0 || referenceNo) break;
  }
  const count = await upsertAsnRows(clientId, asns);
  return { asns: count };
}

/**
 * createAsn from a restock request (verify=1, income_type 0 = delivered to the warehouse).
 * Returns the receiving_code and stores the row in inbound_cache (status announced).
 */
export async function createAsnForRestock(
  clientId: string,
  productId: string,
  qty: number,
  trackingNo?: string | null,
  config?: ClientEccangConfig,
) {
  const cfg = config ?? (await getCredentialsForClient(clientId));
  const { credentials, warehouseCode } = requireEccangClient(cfg);
  const admin = createAdminClient();
  const { data: product } = await admin
    .from("products_cache")
    .select("*")
    .eq("id", productId)
    .eq("client_id", clientId)
    .maybeSingle<ProductRow>();
  if (!product?.sku) throw new Error("Product has no SKU — cannot create an inbound notice.");
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("Quantity must be a positive integer.");
  const referenceNo = asnReferenceNo(cfg.clientCode);
  const payload = {
    reference_no: referenceNo,
    warehouse_code: warehouseCode,
    income_type: 0,
    receiving_desc: `Voltship restock · ${product.title}`.slice(0, 255),
    verify: 1,
    ...(trackingNo?.trim() ? { tracking_number: trackingNo.trim().slice(0, 200) } : {}),
    items: [{ product_sku: product.sku, quantity: qty, box_no: 1 }],
  };
  const response = await callEccang<unknown>(credentials, "createAsn", payload);
  const receivingCode = typeof response.receiving_code === "string" ? response.receiving_code : null;
  const now = new Date().toISOString();
  const { error } = await admin.from("inbound_cache").upsert(
    {
      client_id: clientId,
      product_id: productId,
      reference_no: referenceNo,
      eccang_asn_code: receivingCode,
      eccang_ref: receivingCode,
      eccang_status: "C",
      status: "announced",
      qty_announced: qty,
      items_json: [{ sku: product.sku, qty, received: 0, putaway: 0 }],
      tracking_no: trackingNo?.trim() || null,
      updated_at: now,
    },
    { onConflict: "client_id,reference_no" },
  );
  if (error) throw error;
  return { referenceNo, receivingCode };
}

/** Hook for requestRestockAction. Never throws. */
export async function createAsnIfEnabled(clientId: string, productId: string, qty: number | null) {
  if (!qty || !Number.isInteger(qty) || qty <= 0) return null;
  const { active, config } = await isEccangActive(clientId);
  if (!active || !config) return null;
  try {
    return await createAsnForRestock(clientId, productId, qty, null, config);
  } catch (error) {
    await notify(clientId, "eccang_asn_failed", {
      message: `Avis de réception non créé dans l'entrepôt : ${errorText(error, "erreur ECCANG")}.`,
      productId,
    });
    return null;
  }
}

// --- Full sync (cron + "Synchroniser maintenant") --------------------------------------

export async function syncClient(clientId: string) {
  const admin = createAdminClient();
  const cfg = await getCredentialsForClient(clientId);
  const summary = { inventory: 0, orders: 0, asns: 0, errors: [] as string[] };
  try {
    requireEccangClient(cfg);
    const steps: Array<[string, () => Promise<void>]> = [
      ["inventory", async () => void (summary.inventory = (await pullInventory(clientId, cfg)).skus)],
      ["orders", async () => void (summary.orders = (await pullPendingOrders(clientId, cfg)).polled)],
      ["asn", async () => void (summary.asns = (await pullAsn(clientId, cfg)).asns)],
    ];
    for (const [name, step] of steps) {
      try {
        await step();
      } catch (error) {
        summary.errors.push(`${name}: ${errorText(error, "failed")}`);
      }
    }
  } catch (error) {
    summary.errors.push(errorText(error, "ECCANG sync failed."));
  }
  await admin
    .from("clients")
    .update({
      eccang_last_sync_at: new Date().toISOString(),
      eccang_sync_error: summary.errors.length ? summary.errors.join(" | ").slice(0, 1000) : null,
    })
    .eq("id", clientId);
  return summary;
}

export async function listEccangEnabledClientIds() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("clients")
    .select("id")
    .eq("eccang_enabled", true)
    .not("eccang_app_key", "is", null);
  return (data ?? []).map((row) => row.id as string);
}

export async function syncAllEccangClients() {
  const ids = await listEccangEnabledClientIds();
  const results: Record<string, Awaited<ReturnType<typeof syncClient>>> = {};
  for (const id of ids) results[id] = await syncClient(id);
  return { clients: ids.length, results };
}

/** Resolves a client from the appKey ECCANG sends in callbacks. */
export async function findClientByAppKey(appKey: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("clients")
    .select("id, eccang_enabled")
    .eq("eccang_app_key", appKey)
    .maybeSingle();
  return data?.id ?? null;
}

export type { EccangCredentials };
