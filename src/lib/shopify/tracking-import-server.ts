import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptShopifyToken } from "@/lib/shopify/crypto";
import { createFulfillmentForOrder } from "@/lib/shopify/admin-api";
import { trackingUrlFor, type TrackingRow } from "@/lib/shopify/tracking-import";

export type TrackingPushStatus = "fulfilled" | "already_fulfilled" | "not_found" | "ambiguous" | "error";

export type TrackingPushResult = {
  line: number;
  order: string;
  tracking: string;
  status: TrackingPushStatus;
  shop?: string;
  message?: string;
};

type ShopTarget = { id: string; domain: string; token: string };

/** Active Shopify stores of a client with a usable token (optionally one store only). */
export async function loadClientShops(clientId: string, shopId?: string | null): Promise<ShopTarget[]> {
  const admin = createAdminClient();
  let query = admin
    .from("shops")
    .select("id, shopify_domain, access_token_encrypted, status")
    .eq("client_id", clientId)
    .eq("status", "active");
  if (shopId) query = query.eq("id", shopId);
  const { data, error } = await query;
  if (error) throw error;
  const shops: ShopTarget[] = [];
  for (const shop of data ?? []) {
    if (!shop.access_token_encrypted) continue;
    try {
      shops.push({ id: shop.id, domain: shop.shopify_domain, token: decryptShopifyToken(shop.access_token_encrypted) });
    } catch {
      // Unreadable token: the store must be reconnected; it is simply skipped here.
    }
  }
  return shops;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").slice(0, 220);
}

async function fulfil(shop: ShopTarget, orderId: string, row: TrackingRow, notify: boolean) {
  const tracking = {
    number: row.trackingNumber,
    company: row.company,
    url: trackingUrlFor(row.company, row.trackingNumber),
  };
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await createFulfillmentForOrder(shop.domain, shop.token, orderId, tracking, { notifyCustomer: notify });
    } catch (error) {
      // Shopify's GraphQL cost limit: wait for the bucket to refill, then retry.
      if (attempt < 3 && /throttl|too many requests|429/i.test(shortError(error))) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Creates the Shopify fulfillment (tracking number, carrier, link, optional customer email)
 * of each row, in the client's own stores only. The order is found by its id (the app's
 * order cache tells which store; otherwise each store is tried) or by its number. An order
 * already fulfilled is left as it is ("already_fulfilled"): re-running a file is safe.
 */
export async function pushTrackingRows(
  clientId: string,
  rows: TrackingRow[],
  options: { notify: boolean; shopId?: string | null },
): Promise<TrackingPushResult[]> {
  const shops = await loadClientShops(clientId, options.shopId);
  const label = (row: TrackingRow) => (row.orderName ? `#${row.orderName}` : row.shopifyOrderId ?? "?");
  if (shops.length === 0) {
    return rows.map((row) => ({
      line: row.line,
      order: label(row),
      tracking: row.trackingNumber,
      status: "error" as const,
      message: "No active Shopify store with a token for this client.",
    }));
  }
  const shopById = new Map(shops.map((shop) => [shop.id, shop]));
  const admin = createAdminClient();
  const ids = [...new Set(rows.map((row) => row.shopifyOrderId).filter((id): id is string => Boolean(id)))];
  const names = [
    ...new Set(rows.filter((row) => !row.shopifyOrderId).map((row) => row.orderName).filter((n): n is string => Boolean(n))),
  ];
  const [byId, byName] = await Promise.all([
    ids.length
      ? admin
          .from("shopify_orders_cache")
          .select("shop_id, shopify_order_id")
          .eq("client_id", clientId)
          .in("shop_id", [...shopById.keys()])
          .in("shopify_order_id", ids)
      : Promise.resolve({ data: [] as Array<{ shop_id: string; shopify_order_id: string }> }),
    names.length
      ? admin
          .from("shopify_orders_cache")
          .select("shop_id, shopify_order_id, order_number")
          .eq("client_id", clientId)
          .in("shop_id", [...shopById.keys()])
          .in("order_number", names)
      : Promise.resolve({ data: [] as Array<{ shop_id: string; shopify_order_id: string; order_number: string }> }),
  ]);
  const shopOfId = new Map((byId.data ?? []).map((row) => [row.shopify_order_id, row.shop_id]));
  const matchesOfName = new Map<string, Array<{ shopId: string; orderId: string }>>();
  for (const row of (byName.data ?? []) as Array<{ shop_id: string; shopify_order_id: string; order_number: string }>) {
    const list = matchesOfName.get(row.order_number) ?? [];
    list.push({ shopId: row.shop_id, orderId: row.shopify_order_id });
    matchesOfName.set(row.order_number, list);
  }

  const results: TrackingPushResult[] = [];
  for (const row of rows) {
    const base = { line: row.line, order: label(row), tracking: row.trackingNumber };
    let candidates: Array<{ shop: ShopTarget; orderId: string }>;
    if (row.shopifyOrderId) {
      const cachedShop = shopById.get(shopOfId.get(row.shopifyOrderId) ?? "");
      candidates = (cachedShop ? [cachedShop] : shops).map((shop) => ({ shop, orderId: row.shopifyOrderId as string }));
    } else {
      const matches = matchesOfName.get(row.orderName ?? "") ?? [];
      if (matches.length > 1) {
        results.push({ ...base, status: "ambiguous", message: "Same order number in several stores: pick the store." });
        continue;
      }
      candidates = matches
        .map((match) => ({ shop: shopById.get(match.shopId), orderId: match.orderId }))
        .filter((c): c is { shop: ShopTarget; orderId: string } => Boolean(c.shop));
    }
    if (candidates.length === 0) {
      results.push({ ...base, status: "not_found", message: "Order not found in this client's stores." });
      continue;
    }
    let done: TrackingPushResult | null = null;
    let lastError: string | null = null;
    for (const candidate of candidates) {
      try {
        const fulfillmentId = await fulfil(candidate.shop, candidate.orderId, row, options.notify);
        done = { ...base, status: fulfillmentId ? "fulfilled" : "already_fulfilled", shop: candidate.shop.domain };
        break;
      } catch (error) {
        const message = shortError(error);
        if (/not found|invalid id/i.test(message)) continue;
        lastError = message;
        done = { ...base, status: "error", shop: candidate.shop.domain, message };
        break;
      }
    }
    results.push(done ?? { ...base, status: "not_found", message: lastError ?? "Order not found in this client's stores." });
  }
  return results;
}
