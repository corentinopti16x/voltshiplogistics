import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createNotification } from "@/lib/notifications/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  finishWebhookEvent,
  persistWebhookEvent,
} from "@/lib/integrations/webhook-events";
import type { ResearchKind } from "@/lib/products/types";
import { getAirtableConfig } from "@/lib/airtable/config";
import { patchAirtableProduct } from "@/lib/airtable/products";

type CallbackBody = {
  external_id?: string;
  type?: string;
  client_id: string;
  product_id?: string;
  airtable_record_id?: string;
  deliverable_type: ResearchKind;
  status: "ready" | "failed";
  url?: string;
  summary?: string;
  title?: string;
  error?: string;
};

export async function POST(request: Request) {
  const secret = process.env.N8N_SHARED_SECRET;
  const supplied =
    request.headers.get("x-api-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || supplied !== secret) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: CallbackBody;
  try {
    body = (await request.json()) as CallbackBody;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (
    !body.client_id ||
    !body.deliverable_type ||
    !["brief", "reddit", "personas"].includes(body.deliverable_type) ||
    !["ready", "failed"].includes(body.status)
  ) {
    return Response.json({ error: "Invalid callback payload." }, { status: 400 });
  }

  const event = await persistWebhookEvent({
    source: "n8n",
    type: body.type ?? "research.callback",
    externalId: body.external_id ?? randomUUID(),
    payload: body,
  });
  if (event.status === "processed") {
    return Response.json({ ok: true, duplicate: true });
  }

  try {
    const admin = createAdminClient();
    let query = admin
      .from("products_cache")
      .select("id, title, quote_json")
      .eq("client_id", body.client_id);
    query = body.product_id
      ? query.eq("id", body.product_id)
      : query.eq("airtable_record_id", body.airtable_record_id ?? "");
    const { data: product } = await query.maybeSingle();
    if (!product) throw new Error("Product not found.");

    const quote =
      product.quote_json && typeof product.quote_json === "object"
        ? { ...product.quote_json }
        : {};
    const research =
      quote._research && typeof quote._research === "object"
        ? { ...(quote._research as Record<string, unknown>) }
        : {};
    research[body.deliverable_type] =
      body.status === "ready"
        ? {
            status: "ready",
            ready_at: new Date().toISOString(),
            title: body.title,
            summary: body.summary,
            url: body.url,
          }
        : {
            status: "not_generated",
            error: body.error ?? "Research generation failed.",
          };

    const { error } = await admin
      .from("products_cache")
      .update({ quote_json: { ...quote, _research: research } })
      .eq("id", product.id)
      .eq("client_id", body.client_id);
    if (error) throw error;
    if (
      getAirtableConfig().configured &&
      body.airtable_record_id &&
      !body.airtable_record_id.startsWith("pending:")
    ) {
      await patchAirtableProduct(body.airtable_record_id, {
        researchJson: JSON.stringify(research),
      });
    }

    await createNotification({
      clientId: body.client_id,
      type: body.status === "ready" ? "research_ready" : "research_failed",
      channels: ["in_app", "email"],
      payload: {
        productId: product.id,
        productTitle: product.title,
        deliverableType: body.deliverable_type,
        message:
          body.status === "ready"
            ? `${body.deliverable_type} research is ready for ${product.title}.`
            : `${body.deliverable_type} research failed for ${product.title}.`,
      },
    });
    await finishWebhookEvent(event.id, "processed");
    revalidatePath(`/products/${product.id}`);
    revalidatePath("/[locale]/products/[id]", "page");
    revalidatePath("/notifications");
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Callback processing failed.";
    await finishWebhookEvent(event.id, "dead", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
