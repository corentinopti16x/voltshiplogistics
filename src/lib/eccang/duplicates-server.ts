import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { callEccang, requireEccangClient, type ClientEccangConfig, type EccangCredentials } from "@/lib/eccang/client";
import {
  findDuplicateGroups,
  interpretCancelResponse,
  isShopifyOrderId,
  shopifyCarrierFor,
  type CancelOutcome,
  type DuplicateCandidate,
} from "@/lib/eccang/duplicates";
import { createNotification } from "@/lib/notifications/server";
import { pushTrackingRows } from "@/lib/shopify/tracking-import-server";
import type { TrackingRow } from "@/lib/shopify/tracking-import";

/** Orders sent to Shopify per sync run (≈ 2 Shopify calls each; the cron runs every 15 min). */
const FULFIL_BATCH = 60;

/**
 * Cancelling a duplicate through the ECCANG API is only attempted when
 * ECCANG_AUTO_CANCEL_DUPLICATES=1 (service name overridable with ECCANG_CANCEL_SERVICE).
 * Without it the duplicates are only reported, to be cancelled in the OMS.
 */
function autoCancelEnabled() {
  return process.env.ECCANG_AUTO_CANCEL_DUPLICATES === "1";
}

export function eccangCancelService() {
  return process.env.ECCANG_CANCEL_SERVICE?.trim() || "cancelOrder";
}

/** cancelOrder {order_code, reason} → cancelled / pending (interception en cours) / failed. */
export async function cancelEccangOrder(
  credentials: EccangCredentials,
  orderCode: string,
  reason: string,
): Promise<CancelOutcome> {
  try {
    const response = await callEccang(
      credentials,
      eccangCancelService(),
      { order_code: orderCode, reason: reason.slice(0, 200) },
      { allowFailure: true },
    );
    return interpretCancelResponse(response as Parameters<typeof interpretCancelResponse>[0]);
  } catch (error) {
    return { status: "failed", cancelStatus: null, message: error instanceof Error ? error.message : "ECCANG call failed." };
  }
}

async function orderNumbers(clientId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const admin = createAdminClient();
  const { data } = await admin
    .from("shopify_orders_cache")
    .select("shopify_order_id, order_number")
    .eq("client_id", clientId)
    .in("shopify_order_id", ids);
  return new Map((data ?? []).map((row) => [String(row.shopify_order_id), String(row.order_number)]));
}

/**
 * Règle anti-doublon : every ECCANG order of the client is grouped by Shopify order id. For
 * each new duplicate, an alert names the Shopify order (#…) and the ECCANG orders to cancel
 * (or the double shipment to stop). Each duplicate is reported once (duplicate_alerted_at).
 */
export async function checkDuplicateOrders(clientId: string, config: ClientEccangConfig) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("eccang_orders")
    .select("id, external_ref, eccang_order_code, status, eccang_created_at, tracking_no, duplicate_alerted_at")
    .eq("client_id", clientId)
    .not("external_ref", "is", null)
    .neq("status", "X")
    .limit(20000);
  if (error) throw new Error(`duplicates: ${error.message} (migration 00024 appliquée ?)`);
  const rows = (data ?? []) as Array<DuplicateCandidate & { duplicate_alerted_at: string | null }>;
  const alerted = new Set(rows.filter((row) => row.duplicate_alerted_at).map((row) => row.id));
  const groups = findDuplicateGroups(rows).filter((group) =>
    [...group.toCancel, ...group.shippedTwice].some((row) => !alerted.has(row.id)),
  );
  const result = { groups: groups.length, toCancel: 0, shippedTwice: 0, cancelled: 0 };
  if (groups.length === 0) return result;

  const numbers = await orderNumbers(clientId, groups.map((group) => group.shopifyOrderId));
  const cancel = autoCancelEnabled();
  const credentials = cancel ? requireEccangClient(config).credentials : null;
  for (const group of groups) {
    const label = numbers.has(group.shopifyOrderId) ? `#${numbers.get(group.shopifyOrderId)}` : group.shopifyOrderId;
    const cancelled: string[] = [];
    const intercepting: string[] = [];
    if (credentials) {
      for (const row of group.toCancel) {
        if (!row.eccang_order_code) continue;
        const outcome = await cancelEccangOrder(
          credentials,
          row.eccang_order_code,
          `Doublon de ${label} (gardé : ${group.keep.eccang_order_code})`,
        );
        if (outcome.status === "cancelled") cancelled.push(row.eccang_order_code);
        else if (outcome.status === "pending") intercepting.push(row.eccang_order_code);
      }
    }
    result.toCancel += group.toCancel.length;
    result.shippedTwice += group.shippedTwice.length;
    result.cancelled += cancelled.length;
    const codes = (list: DuplicateCandidate[]) => list.map((row) => row.eccang_order_code ?? row.id).join(", ");
    const parts = [
      `Doublon ECCANG ${label} : gardé ${group.keep.eccang_order_code ?? "?"}.`,
      group.toCancel.length
        ? cancelled.length + intercepting.length === group.toCancel.length
          ? [cancelled.length ? `Annulé : ${cancelled.join(", ")}.` : "", intercepting.length ? `Interception en cours : ${intercepting.join(", ")}.` : ""]
              .filter(Boolean)
              .join(" ")
          : `À annuler dans le OMS avant préparation : ${codes(group.toCancel.filter((row) => !cancelled.includes(row.eccang_order_code ?? "") && !intercepting.includes(row.eccang_order_code ?? "")))}.`
        : "",
      group.shippedTwice.length
        ? `DÉJÀ EXPÉDIÉ DEUX FOIS : ${group.shippedTwice.map((row) => `${row.eccang_order_code} (${row.tracking_no ?? "sans suivi"})`).join(", ")} — à intercepter chez le transporteur.`
        : "",
    ].filter(Boolean);
    await createNotification({
      clientId,
      type: "eccang_duplicate",
      payload: {
        message: parts.join(" "),
        shopifyOrderId: group.shopifyOrderId,
        orderNumber: numbers.get(group.shopifyOrderId) ?? null,
        keep: group.keep.eccang_order_code,
        toCancel: group.toCancel.map((row) => row.eccang_order_code),
        shippedTwice: group.shippedTwice.map((row) => ({ code: row.eccang_order_code, tracking: row.tracking_no })),
        cancelled,
        intercepting,
      },
      channels: ["in_app"],
    }).catch(() => null);
    const ids = [...group.toCancel, ...group.shippedTwice].map((row) => row.id);
    await admin.from("eccang_orders").update({ duplicate_alerted_at: new Date().toISOString() }).in("id", ids);
  }
  return result;
}

/**
 * ECCANG only marks Shopify orders as shipped for orders it pulled from a bound store. Orders
 * imported by file (or created by hand) stay "unfulfilled" in Shopify, so the Shopify sync can
 * pull them again → double shipment. Every shipped ECCANG order with a tracking number gets
 * its Shopify fulfillment here (customer email on); an order already fulfilled is untouched.
 */
export async function fulfilShippedExternalOrders(clientId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("eccang_orders")
    .select("id, external_ref, tracking_no, carrier_code")
    .eq("client_id", clientId)
    .eq("source", "external")
    .eq("status", "D")
    .is("fulfilled_at", null)
    .not("tracking_no", "is", null)
    .order("shipped_at", { ascending: true })
    .limit(FULFIL_BATCH * 3);
  if (error) throw error;
  const pending = (data ?? []).filter((row) => isShopifyOrderId(row.external_ref)).slice(0, FULFIL_BATCH);
  const result = { sent: pending.length, fulfilled: 0, alreadyFulfilled: 0, notFound: 0, errors: 0 };
  if (pending.length === 0) return result;

  const rows: TrackingRow[] = pending.map((row, index) => ({
    line: index + 2,
    orderName: null,
    shopifyOrderId: String(row.external_ref).trim(),
    trackingNumber: String(row.tracking_no).trim(),
    company: shopifyCarrierFor(String(row.tracking_no), row.carrier_code),
  }));
  const results = await pushTrackingRows(clientId, rows, { notify: true });
  const now = new Date().toISOString();
  for (const [index, outcome] of results.entries()) {
    const row = pending[index];
    if (outcome.status === "fulfilled" || outcome.status === "already_fulfilled") {
      if (outcome.status === "fulfilled") result.fulfilled += 1;
      else result.alreadyFulfilled += 1;
      await admin.from("eccang_orders").update({ fulfilled_at: now }).eq("id", row.id);
    } else if (outcome.status === "not_found") {
      // Not an order of the client's Shopify stores (manual ECCANG order): never retried.
      result.notFound += 1;
      await admin.from("eccang_orders").update({ fulfilled_at: now, error: "Shopify: commande introuvable" }).eq("id", row.id);
    } else {
      result.errors += 1;
      await admin
        .from("eccang_orders")
        .update({ error: `Shopify: ${outcome.message ?? outcome.status}`.slice(0, 300) })
        .eq("id", row.id);
    }
  }
  return result;
}
