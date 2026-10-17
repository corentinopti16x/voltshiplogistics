"use server";

import { writeAudit } from "@/lib/auth/audit";
import { getAuthContext } from "@/lib/auth/context";
import { sanitizeTrackingRows } from "@/lib/shopify/tracking-import";
import { pushTrackingRows, type TrackingPushResult } from "@/lib/shopify/tracking-import-server";

export type TrackingChunkResult = {
  ok: boolean;
  code?: "admin" | "consent" | "client" | "rows";
  error?: string;
  results?: TrackingPushResult[];
};

/**
 * Sends one chunk (≤ 20 orders) of a tracking file to the client's Shopify stores. The form
 * calls it chunk after chunk so a long file never hits the function time limit; an order
 * already fulfilled is skipped, so the same file can be sent again safely.
 */
export async function pushTrackingChunkAction(input: {
  clientId: string;
  shopId?: string | null;
  notify: boolean;
  consent: boolean;
  rows: unknown;
}): Promise<TrackingChunkResult> {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "voltship_admin") return { ok: false, code: "admin" };
  if (input.consent !== true) return { ok: false, code: "consent" };
  const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return { ok: false, code: "client" };
  const shopId = typeof input.shopId === "string" && /^[0-9a-f-]{36}$/i.test(input.shopId) ? input.shopId : null;
  const rows = sanitizeTrackingRows(input.rows);
  if (!rows) return { ok: false, code: "rows" };

  try {
    const results = await pushTrackingRows(clientId, rows, { notify: input.notify === true, shopId });
    const count = (status: TrackingPushResult["status"]) => results.filter((r) => r.status === status).length;
    await writeAudit({
      actorUserId: ctx.userId,
      clientId,
      action: "shopify.tracking.push",
      entity: "shopify_fulfillment",
      diff: {
        rows: rows.length,
        fulfilled: count("fulfilled"),
        alreadyFulfilled: count("already_fulfilled"),
        notFound: count("not_found"),
        ambiguous: count("ambiguous"),
        errors: count("error"),
        notify: input.notify === true,
        shopId,
      },
    }).catch(() => null);
    return { ok: true, results };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 220) : "Push failed." };
  }
}
