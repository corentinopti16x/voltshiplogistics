import "server-only";

import { shopifyAppCredentialsFor } from "./app-credentials";

import { createAdminClient } from "@/lib/supabase/admin";
import { encryptShopifyToken } from "@/lib/shopify/crypto";
import {
  cacheOrderLines,
  customerKeyForOrder,
  hashCustomerEmail,
  isShopifyFulfilled,
  orderNumberOf,
  isSuspiciousOrder,
  packOrderLines,
  pickProductImages,
} from "@/lib/shopify/order-cache";

const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-07";

export type ShopifyOrder = {
  id: number;
  created_at: string;
  cancelled_at: string | null;
  fulfillment_status?: string | null;
  line_items: Array<{
    sku: string | null;
    quantity: number;
    title?: string | null;
    name?: string | null;
    price?: string | number | null;
    requires_shipping?: boolean | null;
  }>;
  /** Only the id is read (hashed into customer_key); never persisted raw. */
  customer?: { id?: number | string | null } | null;
  email?: string | null;
  contact_email?: string | null;
  /** Fields below are only read to push the order to the warehouse (ECCANG); never cached. */
  order_number?: number | string | null;
  name?: string | null;
  phone?: string | null;
  /** Amount paid by the customer (products + shipping + taxes − discounts) and its currency;
   * cached with the order for the dashboard revenue, and sent to the warehouse. */
  currency?: string | null;
  total_price?: string | number | null;
  shipping_address?: import("@/lib/eccang/mapping").ShopifyAddress | null;
};

type ShopifyProduct = {
  id: number;
  title: string;
  status: string;
  image?: { src?: string } | null;
  variants: Array<{
    id: number;
    sku: string | null;
    price?: string | null;
    image_id?: number | null;
  }>;
  images?: Array<{ id: number; src: string; position?: number }>;
};

function adminUrl(shop: string, path: string) {
  return `https://${shop}/admin/api/${apiVersion}/${path.replace(/^\//, "")}`;
}

export async function shopifyRequest<T>(
  shop: string,
  accessToken: string,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(adminUrl(shop, path), {
    ...init,
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Shopify ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return {
    data: (await response.json()) as T,
    link: response.headers.get("link"),
  };
}

type FulfillmentNode = {
  legacyResourceId: string;
  displayFulfillmentStatus: string;
};

type FulfillmentPayload = {
  data?: {
    orders: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: FulfillmentNode[];
    };
  };
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
};

export async function loadShopifyFulfillmentMap(
  shop: string,
  accessToken: string,
  since: Date,
) {
  const map = new Map<string, boolean>();
  let cursor: string | null = null;
  const search = `created_at:>='${since.toISOString()}'`;
  const query = `query OrderFulfillment($cursor: String, $search: String!) {
    orders(first: 100, after: $cursor, query: $search, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { legacyResourceId displayFulfillmentStatus }
    }
  }`;

  for (;;) {
    let payload: FulfillmentPayload | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables: { cursor, search } }),
        cache: "no-store",
      });
      payload = (await response.json()) as FulfillmentPayload;
      const throttled =
        response.status === 429 ||
        Boolean(payload.errors?.some((error) => error.extensions?.code === "THROTTLED"));
      if (throttled) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      if (!response.ok || payload.errors?.length || !payload.data) {
        throw new Error(
          payload.errors?.[0]?.message ?? `Shopify fulfillment query failed (${response.status}).`,
        );
      }
      break;
    }
    if (!payload?.data) throw new Error("Shopify fulfillment query was throttled.");
    for (const node of payload.data.orders.nodes) {
      map.set(node.legacyResourceId, node.displayFulfillmentStatus === "FULFILLED");
    }
    if (!payload.data.orders.pageInfo.hasNextPage) break;
    cursor = payload.data.orders.pageInfo.endCursor;
  }

  return map;
}

type GraphqlPayload<T> = {
  data?: T;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
};

async function shopifyGraphql<T>(
  shop: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
) {
  const response = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const payload = (await response.json()) as GraphqlPayload<T>;
  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new Error(
      payload.errors?.[0]?.message ?? `Shopify GraphQL request failed (${response.status}).`,
    );
  }
  return payload.data;
}

export type ShopifyTrackingInfo = { number: string; company?: string | null; url?: string | null };

/**
 * Marks a Shopify order as fulfilled with a tracking number: lists the order's open
 * fulfillment orders (write_merchant_managed_fulfillment_orders) and creates ONE
 * fulfillment covering all of them (write_fulfillments). Returns the fulfillment id, or
 * `null` when nothing is left to fulfil (already fulfilled / closed).
 */
export async function createFulfillmentForOrder(
  shop: string,
  accessToken: string,
  shopifyOrderId: string,
  tracking: ShopifyTrackingInfo,
) {
  const orderGid = shopifyOrderId.startsWith("gid://")
    ? shopifyOrderId
    : `gid://shopify/Order/${shopifyOrderId}`;
  const lookup = await shopifyGraphql<{
    order: { fulfillmentOrders: { nodes: Array<{ id: string; status: string }> } } | null;
  }>(
    shop,
    accessToken,
    `query FulfillmentOrders($id: ID!) {
      order(id: $id) { fulfillmentOrders(first: 20) { nodes { id status } } }
    }`,
    { id: orderGid },
  );
  if (!lookup.order) throw new Error(`Shopify order ${shopifyOrderId} not found.`);
  const open = lookup.order.fulfillmentOrders.nodes.filter((node) =>
    ["OPEN", "IN_PROGRESS", "SCHEDULED", "ON_HOLD"].includes(node.status),
  );
  if (open.length === 0) return null;

  const fulfillment = {
    lineItemsByFulfillmentOrder: open.map((node) => ({ fulfillmentOrderId: node.id })),
    trackingInfo: {
      number: tracking.number,
      ...(tracking.company ? { company: tracking.company } : {}),
      ...(tracking.url ? { url: tracking.url } : {}),
    },
    notifyCustomer: true,
  };
  type Result = { fulfillment: { id: string } | null; userErrors: Array<{ message: string }> };
  const mutationFor = (name: string) =>
    `mutation CreateFulfillment($fulfillment: FulfillmentInput!) {
      ${name}(fulfillment: $fulfillment) { fulfillment { id } userErrors { field message } }
    }`;
  let result: Result | undefined;
  try {
    const data = await shopifyGraphql<{ fulfillmentCreate: Result }>(
      shop,
      accessToken,
      mutationFor("fulfillmentCreate"),
      { fulfillment },
    );
    result = data.fulfillmentCreate;
  } catch (error) {
    // Older API versions only expose fulfillmentCreateV2 (same input shape).
    if (!(error instanceof Error) || !/fulfillmentCreate|doesn't exist|Field/i.test(error.message)) {
      throw error;
    }
    const data = await shopifyGraphql<{ fulfillmentCreateV2: Result }>(
      shop,
      accessToken,
      mutationFor("fulfillmentCreateV2"),
      { fulfillment },
    );
    result = data.fulfillmentCreateV2;
  }
  if (!result) throw new Error("Shopify returned no fulfillment result.");
  if (result.userErrors?.length) {
    throw new Error(`Shopify fulfillment: ${result.userErrors.map((e) => e.message).join("; ")}`);
  }
  return result.fulfillment?.id ?? null;
}

function nextPagePath(link: string | null) {
  if (!link) return null;
  const next = link
    .split(",")
    .find((part) => part.includes('rel="next"'))
    ?.match(/<([^>]+)>/)?.[1];
  if (!next) return null;
  const url = new URL(next);
  return `${url.pathname.split(`/admin/api/${apiVersion}/`)[1]}${url.search}`;
}

function shopifyTokenError(status: number, text: string) {
  try {
    const parsed = JSON.parse(text) as { error?: string; error_description?: string };
    const detail = [parsed.error, parsed.error_description].filter(Boolean).join(": ");
    if (detail && detail.length < 180 && !detail.toLowerCase().includes("secret")) {
      return `Shopify rejected the shop connection (${status}): ${detail}.`;
    }
  } catch {
    // Response was not JSON.
  }
  return `Shopify rejected the shop connection (${status}). Please try connecting the store again.`;
}

export async function issueShopifyAccessToken(shop: string) {
  const { apiKey: clientId, apiSecret: clientSecret } = await shopifyAppCredentialsFor(shop);
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(shopifyTokenError(response.status, text));
  const data = JSON.parse(text) as { access_token?: string; scope?: string };
  if (!data.access_token) throw new Error("Shopify did not return an access token.");
  return { accessToken: data.access_token, scope: data.scope ?? "" };
}

export async function connectInstalledShopifyShop(input: {
  clientId: string;
  shop: string;
  appUrl: string;
}) {
  const issued = await issueShopifyAccessToken(input.shop);
  const admin = createAdminClient();
  const { data: saved, error } = await admin
    .from("shops")
    .upsert(
      {
        client_id: input.clientId,
        shopify_domain: input.shop,
        access_token_encrypted: encryptShopifyToken(issued.accessToken),
        scopes: issued.scope,
        status: "active",
        sync_error: null,
      },
      { onConflict: "client_id,shopify_domain" },
    )
    .select("id")
    .single();
  if (error || !saved) throw error ?? new Error("Could not save the Shopify shop.");

  try {
    await registerShopifyWebhooks(input.shop, issued.accessToken, input.appUrl);
  } catch {
    // Shopify cannot call localhost. Order and product sync still run.
  }

  let syncError: string | null = null;
  try {
    await backfillShopifyOrders({
      clientId: input.clientId,
      shopId: saved.id,
      shop: input.shop,
      accessToken: issued.accessToken,
    });
  } catch (error) {
    syncError = error instanceof Error ? error.message : "Order backfill failed.";
  }
  try {
    await syncShopifyProducts({
      clientId: input.clientId,
      shopId: saved.id,
      shop: input.shop,
      accessToken: issued.accessToken,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Product sync failed.";
    syncError = syncError ? `${syncError} ${message}` : message;
  }
  await admin
    .from("shops")
    .update({
      last_synced_at: new Date().toISOString(),
      sync_error: syncError,
    })
    .eq("id", saved.id);
  return { shopId: saved.id, syncError };
}

/** Step 2 of the OAuth grant: exchanges the authorization code for an offline access token. */
export async function exchangeShopifyCode(shop: string, code: string) {
  const { apiKey: clientId, apiSecret: clientSecret } = await shopifyAppCredentialsFor(shop);
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(shopifyTokenError(response.status, text));
  const data = JSON.parse(text) as { access_token?: string; scope?: string };
  if (!data.access_token) throw new Error("Shopify did not return an access token.");
  return { access_token: data.access_token, scope: data.scope ?? "" };
}

/** Webhook topics registered on every connected shop, keyed by the route that receives them. */
export const SHOPIFY_WEBHOOK_TOPICS: Array<{ topic: string; path: string }> = [
  { topic: "orders/create", path: "/api/webhooks/shopify/orders" },
  { topic: "orders/updated", path: "/api/webhooks/shopify/orders" },
];

export async function registerShopifyWebhooks(
  shop: string,
  accessToken: string,
  appUrl: string,
) {
  // Compliance topics (customers/data_request, customers/redact, shop/redact) cannot be
  // subscribed through the Admin API — Shopify requires them to be declared in the app
  // configuration (Partner dashboard / shopify.app.toml) pointing at
  // `${appUrl}/api/webhooks/shopify/compliance`.
  const base = appUrl.replace(/\/$/, "");
  const { data: existing } = await shopifyRequest<{
    webhooks: Array<{ topic: string; address: string }>;
  }>(shop, accessToken, "webhooks.json?limit=250");
  for (const { topic, path } of SHOPIFY_WEBHOOK_TOPICS) {
    const address = `${base}${path}`;
    if (existing.webhooks.some((hook) => hook.topic === topic && hook.address === address)) {
      continue;
    }
    await shopifyRequest(shop, accessToken, "webhooks.json", {
      method: "POST",
      body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
    });
  }
}

export async function backfillShopifyOrders(input: {
  clientId: string;
  shopId: string;
  shop: string;
  accessToken: string;
  /** How many days back to re-read (90 for the nightly full sync, a few for the 10-minute refresh). */
  days?: number;
}) {
  // Start of the UTC day so the sales_cache days rebuilt below are complete.
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (input.days ?? 90));
  since.setUTCHours(0, 0, 0, 0);
  const fulfillment = await loadShopifyFulfillmentMap(input.shop, input.accessToken, since);
  let path =
    `orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(since.toISOString())}` +
    "&fields=id,order_number,name,created_at,cancelled_at,fulfillment_status,total_price,currency,line_items,customer,email,contact_email";
  const counts = new Map<string, number>();
  const orderRows: Array<Record<string, unknown>> = [];
  do {
    const response = await shopifyRequest<{ orders: ShopifyOrder[] }>(
      input.shop,
      input.accessToken,
      path,
    );
    for (const order of response.data.orders) {
      const date = order.created_at.slice(0, 10);
      const normalizedLines = cacheOrderLines(order.line_items);
      orderRows.push({
        client_id: input.clientId,
        shop_id: input.shopId,
        shopify_order_id: String(order.id),
        order_number: orderNumberOf(order),
        placed_at: order.created_at,
        order_date: date,
        cancelled: Boolean(order.cancelled_at),
        customer_key: customerKeyForOrder(order),
        customer_email_key: hashCustomerEmail(order.email ?? order.contact_email),
        line_items_json: packOrderLines(
          normalizedLines,
          fulfillment.get(String(order.id)) ?? isShopifyFulfilled(order.fulfillment_status),
          {
            amount: order.total_price,
            currency: order.currency,
            units: order.line_items.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
          },
        ),
        updated_at: new Date().toISOString(),
      });
      if (order.cancelled_at) continue;
      const orderUnits = order.line_items.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
      if (isSuspiciousOrder(order.total_price, orderUnits)) continue;
      for (const line of order.line_items) {
        const sku = line.sku?.trim();
        if (!sku) continue;
        const key = `${sku}\u0000${date}`;
        counts.set(key, (counts.get(key) ?? 0) + line.quantity);
      }
    }
    path = nextPagePath(response.link) ?? "";
  } while (path);

  const admin = createAdminClient();
  await admin
    .from("sales_cache")
    .delete()
    .eq("client_id", input.clientId)
    .eq("shop_id", input.shopId)
    .gte("date", since.toISOString().slice(0, 10));
  if (orderRows.length > 0) {
    const { error: orderError } = await admin
      .from("shopify_orders_cache")
      .upsert(orderRows, { onConflict: "shop_id,shopify_order_id" });
    if (orderError) throw orderError;
  }
  if (counts.size > 0) {
    const rows = [...counts.entries()].map(([key, units]) => {
      const [sku, date] = key.split("\u0000");
      return {
        client_id: input.clientId,
        shop_id: input.shopId,
        sku,
        date,
        units_sold: units,
      };
    });
    const { error } = await admin
      .from("sales_cache")
      .upsert(rows, { onConflict: "client_id,shop_id,sku,date" });
    if (error) throw error;
  }
  return counts.size;
}

export async function syncShopifyProducts(input: {
  clientId: string;
  shopId: string;
  shop: string;
  accessToken: string;
}) {
  let path = "products.json?limit=250&status=active";
  const rows: Array<Record<string, unknown>> = [];
  const priceByVariant = new Map<string, number>();
  do {
    const response = await shopifyRequest<{ products: ShopifyProduct[] }>(
      input.shop,
      input.accessToken,
      path,
    );
    for (const product of response.data.products) {
      for (const variant of product.variants) {
        const price = Number(variant.price);
        if (Number.isFinite(price) && price > 0) priceByVariant.set(String(variant.id), price);
        const images = pickProductImages(product, variant.image_id);
        rows.push({
          client_id: input.clientId,
          shop_id: input.shopId,
          shopify_product_id: String(product.id),
          shopify_variant_id: String(variant.id),
          title: product.title,
          sku: variant.sku?.trim() || null,
          photo_url: images[0] ?? null,
          images_json: images,
          status: product.status,
          updated_at: new Date().toISOString(),
        });
      }
    }
    path = nextPagePath(response.link) ?? "";
  } while (path);

  const admin = createAdminClient();
  if (rows.length > 0) {
    const { error } = await admin
      .from("shopify_products_cache")
      .upsert(rows, { onConflict: "shop_id,shopify_variant_id" });
    if (error) throw error;
  }

  const { data: sales } = await admin
    .from("sales_cache")
    .select("sku, units_sold")
    .eq("client_id", input.clientId)
    .eq("shop_id", input.shopId)
    .gte("date", new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
  const units = new Map<string, number>();
  for (const row of sales ?? []) {
    units.set(row.sku, (units.get(row.sku) ?? 0) + Number(row.units_sold));
  }
  for (const row of rows) {
    if (!row.sku) continue;
    await admin
      .from("shopify_products_cache")
      .update({ units_90d: units.get(String(row.sku)) ?? 0 })
      .eq("shop_id", input.shopId)
      .eq("shopify_variant_id", row.shopify_variant_id);
  }
  await fillImportedSellingPrices(input.shopId, priceByVariant);
  return rows.length;
}

/**
 * Imported products without a selling price take the cheapest active variant price of
 * their Shopify product (the single-unit offer when variants are quantity bundles).
 * A price already set on the Voltship product is never overwritten.
 */
async function fillImportedSellingPrices(shopId: string, priceByVariant: Map<string, number>) {
  if (priceByVariant.size === 0) return;
  const admin = createAdminClient();
  const { data: imported } = await admin
    .from("shopify_products_cache")
    .select("shopify_variant_id, imported_product_id")
    .eq("shop_id", shopId)
    .not("imported_product_id", "is", null);
  const lowest = new Map<string, number>();
  for (const row of imported ?? []) {
    const price = priceByVariant.get(String(row.shopify_variant_id));
    if (price == null || !row.imported_product_id) continue;
    const current = lowest.get(row.imported_product_id);
    if (current == null || price < current) lowest.set(row.imported_product_id, price);
  }
  for (const [productId, price] of lowest) {
    await admin
      .from("products_cache")
      .update({ selling_price: price })
      .eq("id", productId)
      .is("selling_price", null);
  }
}
