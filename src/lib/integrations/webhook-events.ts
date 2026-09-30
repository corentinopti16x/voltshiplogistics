import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export async function persistWebhookEvent(input: {
  source: string;
  type: string;
  externalId: string;
  payload: unknown;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("webhook_events")
    .upsert(
      {
        source: input.source,
        type: input.type,
        external_id: input.externalId,
        payload_json: input.payload,
        status: "received",
      },
      { onConflict: "source,external_id", ignoreDuplicates: true },
    )
    .select("id, status")
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: existing, error: readError } = await admin
    .from("webhook_events")
    .select("id, status")
    .eq("source", input.source)
    .eq("external_id", input.externalId)
    .maybeSingle();
  if (readError || !existing) throw readError ?? new Error("Webhook event was not persisted.");
  return existing;
}

export async function finishWebhookEvent(
  id: string,
  status: "processed" | "dead",
  error?: string,
) {
  const admin = createAdminClient();
  await admin
    .from("webhook_events")
    .update({
      status,
      error: error ?? null,
      processed_at: status === "processed" ? new Date().toISOString() : null,
    })
    .eq("id", id);
}

export function validCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${secret}`;
}
