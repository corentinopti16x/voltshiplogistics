import { randomUUID } from "crypto";
import { verifyShopifyWebhookHmac } from "@/lib/shopify/auth";
import type { ShopifyOrder } from "@/lib/shopify/admin-api";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  packOrderLines,
  resolveShopifyFulfillment,
  unpackOrderLines,
} from "@/lib/shopify/order-cache";
import {
  finishWebhookEvent,
  persistWebhookEvent,
} from "@/lib/integrations/webhook-events";

type CachedLine = { sku: string; quantity: number };

async function applyLines(input: {
  clientId: string;
  shopId: string;
  date: string;
  lines: CachedLine[];
  direction: 1 | -1;
}) {
  const admin = createAdminClient();
  for (const line of input.lines) {
    await admin.rpc("increment_sales_cache", {
      p_client_id: input.clientId,
      p_shop_id: input.shopId,
      p_sku: line.sku,
      p_date: input.date,
      p_units: line.quantity * input.direction,
    });
  }
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyShopifyWebhookHmac(raw, request.headers.get("x-shopify-hmac-sha256"))) {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }
  const shopDomain = request.headers.get("x-shopify-shop-domain")?.toLowerCase();
  if (!shopDomain) return Response.json({ error: "Missing shop." }, { status: 400 });

  let order: ShopifyOrder;
  try {
    order = JSON.parse(raw) as ShopifyOrder;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const externalId =
    request.headers.get("x-shopify-webhook-id") ??
    `${order.id}:${request.headers.get("x-shopify-triggered-at") ?? randomUUID()}`;
  const event = await persistWebhookEvent({
    source: "shopify",
    type: request.headers.get("x-shopify-topic") ?? "orders/updated",
    externalId,
    payload: order,
  });
  if (event.status === "processed") return Response.json({ ok: true, duplicate: true });

  try {
    const admin = createAdminClient();
    const { data: shop } = await admin
      .from("shops")
      .select("id, client_id")
      .eq("shopify_domain", shopDomain)
      .eq("status", "active")
      .maybeSingle();
    if (!shop) throw new Error("Shop is not connected.");

    const { data: previous } = await admin
      .from("shopify_orders_cache")
      .select("order_date, cancelled, line_items_json")
      .eq("shop_id", shop.id)
      .eq("shopify_order_id", String(order.id))
      .maybeSingle();
    const previousOrder = unpackOrderLines(previous?.line_items_json);
    const previousLines = previousOrder.lines;
    if (previous && !previous.cancelled) {
      await applyLines({
        clientId: shop.client_id,
        shopId: shop.id,
        date: previous.order_date,
        lines: previousLines,
        direction: -1,
      });
    }

    const date = order.created_at.slice(0, 10);
    const lines = order.line_items
      .filter((line) => line.sku?.trim())
      .map((line) => ({ sku: line.sku!.trim(), quantity: line.quantity }));
    if (!order.cancelled_at) {
      await applyLines({
        clientId: shop.client_id,
        shopId: shop.id,
        date,
        lines,
        direction: 1,
      });
    }
    const { error } = await admin.from("shopify_orders_cache").upsert(
      {
        client_id: shop.client_id,
        shop_id: shop.id,
        shopify_order_id: String(order.id),
        order_date: date,
        cancelled: Boolean(order.cancelled_at),
        line_items_json: packOrderLines(
          lines,
          resolveShopifyFulfillment(order.fulfillment_status, previousOrder.fulfilled),
        ),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id,shopify_order_id" },
    );
    if (error) throw error;

    await finishWebhookEvent(event.id, "processed");
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify webhook failed.";
    await finishWebhookEvent(event.id, "dead", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
