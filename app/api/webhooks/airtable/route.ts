import { randomUUID } from "crypto";
import { getAirtableConfig } from "@/lib/airtable/config";
import {
  getAirtableRecord,
  type AirtableRecord,
} from "@/lib/airtable/client";
import { syncAirtableRecord } from "@/lib/airtable/products";
import {
  finishWebhookEvent,
  persistWebhookEvent,
} from "@/lib/integrations/webhook-events";

type AirtableWebhookBody = {
  external_id?: string;
  records?: AirtableRecord[];
  record_ids?: string[];
};

export async function POST(request: Request) {
  const secret = process.env.AIRTABLE_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: "Airtable webhook is not configured." }, { status: 503 });
  }
  if (request.headers.get("x-airtable-webhook-secret") !== secret) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: AirtableWebhookBody;
  try {
    body = (await request.json()) as AirtableWebhookBody;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const externalId = body.external_id || request.headers.get("x-airtable-event-id") || randomUUID();
  const event = await persistWebhookEvent({
    source: "airtable",
    type: "products.changed",
    externalId,
    payload: body,
  });
  if (event.status === "processed") {
    return Response.json({ ok: true, duplicate: true });
  }

  try {
    const config = getAirtableConfig();
    const records = [...(body.records ?? [])];
    for (const recordId of body.record_ids ?? []) {
      records.push(await getAirtableRecord(config.productsTable, recordId));
    }
    if (records.length === 0) {
      throw new Error("Webhook must include records or record_ids.");
    }
    const results = await Promise.all(records.map((record) => syncAirtableRecord(record)));
    const errors = results.filter((result) => !result.ok);
    if (errors.length > 0) throw new Error(errors.map((item) => item.error).join("; "));
    await finishWebhookEvent(event.id, "processed");
    return Response.json({ ok: true, synced: records.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Airtable webhook failed.";
    await finishWebhookEvent(event.id, "dead", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
