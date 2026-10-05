import { randomUUID } from "crypto";
import { verifyShopifyWebhookHmac } from "@/lib/shopify/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { finishWebhookEvent, persistWebhookEvent } from "@/lib/integrations/webhook-events";

/**
 * Shopify mandatory compliance webhooks (GDPR):
 * - customers/data_request, customers/redact → acknowledged (Voltship stores no customer PII:
 *   only order ids, dates and SKU/quantity lines).
 * - shop/redact → the shop is marked disconnected, its token and caches are deleted.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyShopifyWebhookHmac(raw, request.headers.get("x-shopify-hmac-sha256"))) {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }
  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shopDomain = request.headers.get("x-shopify-shop-domain")?.toLowerCase();
  if (!shopDomain) return Response.json({ error: "Missing shop." }, { status: 400 });

  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (topic === "customers/data_request" || topic === "customers/redact") {
    return Response.json({ ok: true, topic });
  }
  if (topic !== "shop/redact") {
    return Response.json({ error: `Unsupported topic: ${topic}` }, { status: 400 });
  }

  const event = await persistWebhookEvent({
    source: "shopify",
    type: topic,
    externalId: request.headers.get("x-shopify-webhook-id") ?? `shop-redact:${shopDomain}:${randomUUID()}`,
    payload,
  });
  if (event.status === "processed") return Response.json({ ok: true, duplicate: true });

  try {
    const admin = createAdminClient();
    const { data: shops } = await admin
      .from("shops")
      .select("id")
      .eq("shopify_domain", shopDomain);
    for (const shop of shops ?? []) {
      await admin.from("shopify_orders_cache").delete().eq("shop_id", shop.id);
      await admin.from("shopify_products_cache").delete().eq("shop_id", shop.id);
      await admin.from("sales_cache").delete().eq("shop_id", shop.id);
      await admin
        .from("shops")
        .update({ status: "disconnected", access_token_encrypted: null, sync_error: null })
        .eq("id", shop.id);
    }
    await finishWebhookEvent(event.id, "processed");
    return Response.json({ ok: true, redacted: (shops ?? []).length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shop redact failed.";
    await finishWebhookEvent(event.id, "dead", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
