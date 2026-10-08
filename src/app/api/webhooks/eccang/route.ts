import { randomUUID, timingSafeEqual } from "crypto";
import {
  finishWebhookEvent,
  persistWebhookEvent,
} from "@/lib/integrations/webhook-events";
import { parseCallback } from "@/lib/eccang/mapping";
import {
  findClientByAppKey,
  importExternalOrder,
  isOwnEccangOrder as isOwnOrder,
  pullAsn,
  pullInventory,
  pullOrderStatus,
} from "@/lib/eccang/sync";

/**
 * ECCANG data-subscription callback (订阅回调).
 *
 * URL to register in ECCANG OMS (消息订阅 / 订阅回调):
 *   https://app.voltshiplogistics.com/api/webhooks/eccang?token=<ECCANG_WEBHOOK_SECRET>
 *
 * - GET  ?random=<n>  → {"random":"<n>"} (ECCANG verifies the URL this way).
 * - POST { app_key, msg_id, subscript_type: order|receiving|stock, body: {...} }
 *   The payload is persisted in webhook_events (idempotent on msg_id), then the latest
 *   state is pulled from ECCANG as the doc instructs: order → getOrderByRefCode,
 *   receiving → getAsnList, stock → getProductInventory.
 *
 * Auth: the `token` query must equal ECCANG_WEBHOOK_SECRET, and `app_key` must match a
 * client's eccang_app_key (that is how the tenant is resolved — one key per client).
 */

function validToken(request: Request) {
  const secret = process.env.ECCANG_WEBHOOK_SECRET;
  if (!secret) return false;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!validToken(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const random = new URL(request.url).searchParams.get("random");
  if (random == null) return Response.json({ ok: true });
  return Response.json({ random });
}

export async function POST(request: Request) {
  if (!validToken(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const raw = await request.text();
  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    try {
      payload = Object.fromEntries(new URLSearchParams(raw));
    } catch {
      return Response.json({ code: 400, msg: "Invalid payload." }, { status: 400 });
    }
  }
  const callback = parseCallback(payload);
  if (!callback.appKey) return Response.json({ code: 401, msg: "Missing app_key." }, { status: 401 });
  const clientId = await findClientByAppKey(callback.appKey);
  if (!clientId) return Response.json({ code: 404, msg: "Unknown app_key." }, { status: 404 });

  const externalId = callback.msgId ?? `${callback.appKey}:${callback.type}:${randomUUID()}`;
  const event = await persistWebhookEvent({
    source: "eccang",
    type: callback.type,
    externalId,
    payload,
  });
  if (event.status === "processed") return Response.json({ code: 200, msg: "duplicate" });

  try {
    const body = callback.body;
    if (callback.type === "order") {
      const referenceNo = String(body.reference_no ?? "").trim();
      if (referenceNo) {
        if (await isOwnOrder(clientId, referenceNo)) await pullOrderStatus(clientId, referenceNo);
        else await importExternalOrder(clientId, referenceNo);
      }
    } else if (callback.type === "receiving") {
      const referenceNo = String(body.reference_no ?? "").trim();
      await pullAsn(clientId, undefined, referenceNo || undefined);
    } else if (callback.type === "stock") {
      await pullInventory(clientId);
    }
    await finishWebhookEvent(event.id, "processed");
    return Response.json({ code: 200, msg: "success" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ECCANG callback failed.";
    await finishWebhookEvent(event.id, "dead", message);
    // Still 200: the doc only treats non-200 as "retry"; the cron will catch up.
    return Response.json({ code: 200, msg: `accepted; processing failed: ${message}` });
  }
}
