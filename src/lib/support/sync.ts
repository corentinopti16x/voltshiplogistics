import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/server";
import { shapePublicOrder, type CachedOrder } from "@/lib/public-api/orders";
import { loadWarehouseOrder } from "@/lib/public-api/orders-server";
import { generateSupportDraft, type DraftOrderContext } from "./draft";
import { fetchGmailMessage, listNewGmailMessageIds, refreshGmailAccessToken } from "./gmail";
import type { ParsedGmailMessage } from "./gmail-parse";
import { matchOrder, type MatchableOrder } from "./match";

export type MailboxRow = {
  id: string;
  client_id: string;
  email_address: string;
  refresh_token_encrypted: string;
  history_id: string | null;
  enabled: boolean;
};

const MATCH_WINDOW_DAYS = 120;

/** Orders of the last 120 days that the matcher can pick from (hashes only, no PII). */
async function loadMatchableOrders(clientId: string): Promise<MatchableOrder[]> {
  const admin = createAdminClient();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - MATCH_WINDOW_DAYS);
  const { data } = await admin
    .from("shopify_orders_cache")
    .select("id, order_number, shopify_order_id, placed_at, order_date, customer_key, customer_email_key")
    .eq("client_id", clientId)
    .gte("order_date", since.toISOString().slice(0, 10))
    .order("order_date", { ascending: false })
    .limit(2_000)
    .returns<MatchableOrder[]>();
  return data ?? [];
}

/** Delivery promise from the accepted quotes of the ordered SKUs (first one found). */
async function loadEta(clientId: string, skus: string[]) {
  if (skus.length === 0) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("products_cache")
    .select("sku, quote_json")
    .eq("client_id", clientId)
    .in("sku", skus);
  for (const row of data ?? []) {
    const quote = row.quote_json as Record<string, unknown> | null;
    const range = quote?.deliveryRange ?? quote?.delivery_range;
    if (typeof range === "string" && range.trim()) return range.trim();
  }
  return null;
}

/** Order facts handed to the draft prompt (same shaping as the public API → no invented data). */
export async function buildOrderContext(clientId: string, orderId: string): Promise<DraftOrderContext | null> {
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("shopify_orders_cache")
    .select(
      "id, shopify_order_id, order_number, placed_at, order_date, cancelled, line_items_json, customer_key, customer_email_key",
    )
    .eq("client_id", clientId)
    .eq("id", orderId)
    .maybeSingle<CachedOrder>();
  if (!order) return null;
  const warehouse = await loadWarehouseOrder(clientId, order.shopify_order_id);
  const shaped = shapePublicOrder(order, warehouse);
  const eta = await loadEta(clientId, shaped.items.map((i) => i.sku));
  return {
    number: shaped.order.number,
    placedAt: shaped.order.placed_at,
    status: shaped.fulfillment.status,
    carrier: shaped.fulfillment.carrier,
    service: shaped.fulfillment.service,
    trackingNumber: shaped.fulfillment.tracking_number,
    trackingUrl: shaped.fulfillment.tracking_url,
    shippedAt: shaped.fulfillment.shipped_at,
    eta,
    items: shaped.items,
  };
}

async function storeName(clientId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("clients").select("name").eq("id", clientId).maybeSingle();
  return data?.name ?? "notre boutique";
}

/** Upserts the thread + message for one parsed Gmail message. Returns the thread id and whether the message was new. */
async function storeMessage(mailbox: MailboxRow, parsed: ParsedGmailMessage, orders: MatchableOrder[]) {
  const admin = createAdminClient();
  const { data: existingMessage } = await admin
    .from("support_messages")
    .select("id")
    .eq("provider_message_id", parsed.providerMessageId)
    .maybeSingle();
  if (existingMessage) return { threadId: null as string | null, isNew: false };

  const { data: existingThread } = await admin
    .from("support_threads")
    .select("id, status, customer_email_hash, matched_order_id, last_message_at")
    .eq("mailbox_id", mailbox.id)
    .eq("provider_thread_id", parsed.providerThreadId)
    .maybeSingle();

  const inbound = parsed.direction === "in";
  const senderHash = inbound ? parsed.fromEmailHash : existingThread?.customer_email_hash ?? null;
  const match = inbound
    ? matchOrder({ subject: parsed.subject, body: parsed.bodyText, senderEmailHash: senderHash, orders })
    : null;

  const isLater = !existingThread?.last_message_at || parsed.receivedAt >= existingThread.last_message_at;
  const threadPatch: Record<string, unknown> = {
    client_id: mailbox.client_id,
    mailbox_id: mailbox.id,
    provider_thread_id: parsed.providerThreadId,
  };
  if (!existingThread) {
    threadPatch.subject = parsed.subject || null;
    threadPatch.customer_email_hash = senderHash;
    threadPatch.customer_name = inbound ? parsed.fromName : null;
    threadPatch.status = inbound ? "open" : "answered";
  } else if (inbound && isLater) {
    threadPatch.status = "open";
    if (!existingThread.customer_email_hash) threadPatch.customer_email_hash = senderHash;
    if (parsed.fromName) threadPatch.customer_name = parsed.fromName;
  } else if (!inbound && isLater && existingThread.status === "open") {
    threadPatch.status = "answered";
  }
  if (isLater) {
    threadPatch.last_message_at = parsed.receivedAt;
    threadPatch.last_direction = parsed.direction;
    threadPatch.snippet = parsed.snippet;
  }
  if (match?.order && (!existingThread?.matched_order_id || match.by === "number")) {
    threadPatch.matched_order_id = match.order.id;
    threadPatch.matched_order_number = match.order.order_number;
  }
  const { data: thread, error: threadError } = await admin
    .from("support_threads")
    .upsert(threadPatch, { onConflict: "mailbox_id,provider_thread_id" })
    .select("id, matched_order_id")
    .single();
  if (threadError || !thread) throw threadError ?? new Error("Could not store support thread.");

  const { error: messageError } = await admin.from("support_messages").upsert(
    {
      thread_id: thread.id,
      provider_message_id: parsed.providerMessageId,
      direction: parsed.direction,
      from_name: parsed.fromName,
      from_email_hash: parsed.fromEmailHash,
      body_text: parsed.bodyText,
      received_at: parsed.receivedAt,
      is_draft: false,
      sent_at: parsed.direction === "out" ? parsed.receivedAt : null,
      rfc_message_id: parsed.rfcMessageId,
    },
    { onConflict: "provider_message_id", ignoreDuplicates: true },
  );
  if (messageError) throw messageError;
  return { threadId: thread.id as string, isNew: inbound, matchedOrderId: thread.matched_order_id as string | null };
}

/** Classifies + drafts a reply for the latest inbound message of a thread. No-op without ANTHROPIC_API_KEY. */
export async function draftForThread(clientId: string, threadId: string) {
  const admin = createAdminClient();
  const { data: thread } = await admin
    .from("support_threads")
    .select("id, subject, customer_name, matched_order_id")
    .eq("id", threadId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!thread) return null;
  const { data: messages } = await admin
    .from("support_messages")
    .select("direction, body_text, received_at")
    .eq("thread_id", threadId)
    .order("received_at", { ascending: true })
    .limit(12);
  const inbound = [...(messages ?? [])].reverse().find((m) => m.direction === "in");
  if (!inbound) return null;
  const history = (messages ?? [])
    .filter((m) => m !== inbound)
    .map((m) => ({ direction: m.direction as "in" | "out", text: m.body_text }));
  const order = thread.matched_order_id ? await buildOrderContext(clientId, thread.matched_order_id) : null;
  const draft = await generateSupportDraft({
    storeName: await storeName(clientId),
    customerName: thread.customer_name,
    subject: thread.subject ?? "",
    message: inbound.body_text,
    order,
    history,
  });
  if (!draft) return null;
  const { data: saved, error } = await admin
    .from("support_drafts")
    .insert({
      thread_id: threadId,
      body_text: draft.reply,
      intent: draft.intent,
      confidence: draft.confidence,
    })
    .select("id")
    .single();
  if (error) throw error;
  return saved?.id ?? null;
}

export async function syncMailbox(mailbox: MailboxRow) {
  const admin = createAdminClient();
  const accessToken = await refreshGmailAccessToken(mailbox.refresh_token_encrypted);
  const { ids, historyId } = await listNewGmailMessageIds(accessToken, mailbox.history_id);
  const orders = await loadMatchableOrders(mailbox.client_id);
  const newThreads = new Set<string>();
  let stored = 0;
  for (const id of ids) {
    const parsed = await fetchGmailMessage(accessToken, id, mailbox.email_address);
    // Skip automated senders (no-reply, bounces) — nothing to answer.
    if (parsed.direction === "in" && /^(no-?reply|mailer-daemon|postmaster|bounce)/i.test(parsed.fromEmail)) continue;
    const result = await storeMessage(mailbox, parsed, orders);
    if (result.threadId && result.isNew) {
      stored += 1;
      newThreads.add(result.threadId);
    }
  }
  let drafted = 0;
  for (const threadId of newThreads) {
    try {
      if (await draftForThread(mailbox.client_id, threadId)) drafted += 1;
    } catch {
      // Draft is best-effort: the thread stays listed without a suggestion.
    }
  }
  await admin
    .from("support_mailboxes")
    .update({ history_id: historyId, last_sync_at: new Date().toISOString(), sync_error: null })
    .eq("id", mailbox.id);
  if (stored > 0) {
    try {
      await createNotification({
        clientId: mailbox.client_id,
        type: "support_new_messages",
        payload: { message: `SAV : ${stored} nouveau(x) message(s) client`, count: stored },
      });
    } catch {
      // best-effort
    }
  }
  return { fetched: ids.length, stored, drafted };
}

export async function syncAllMailboxes() {
  const admin = createAdminClient();
  const { data: mailboxes } = await admin
    .from("support_mailboxes")
    .select("id, client_id, email_address, refresh_token_encrypted, history_id, enabled")
    .eq("enabled", true)
    .returns<MailboxRow[]>();
  const results: Array<{ mailboxId: string; ok: boolean; fetched?: number; stored?: number; drafted?: number; error?: string }> = [];
  for (const mailbox of mailboxes ?? []) {
    try {
      const result = await syncMailbox(mailbox);
      results.push({ mailboxId: mailbox.id, ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gmail sync failed.";
      await admin
        .from("support_mailboxes")
        .update({ sync_error: message.slice(0, 500), last_sync_at: new Date().toISOString() })
        .eq("id", mailbox.id);
      results.push({ mailboxId: mailbox.id, ok: false, error: message });
    }
  }
  return { mailboxes: results.length, results };
}
