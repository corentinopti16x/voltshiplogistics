"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthContext } from "@/lib/auth/context";
import type { ActionResult } from "@/app/actions/admin";
import { generateApiKey } from "@/lib/public-api/keys";
import { fetchGmailMessage, refreshGmailAccessToken, sendGmailReply } from "@/lib/support/gmail";
import { syncMailbox, type MailboxRow } from "@/lib/support/sync";

export type SupportActionResult = ActionResult & { apiKey?: string };

async function requireTenant() {
  const ctx = await getAuthContext();
  if (!ctx?.clientId) return { ctx: null, error: "Not signed in to a workspace." };
  return { ctx, error: null };
}

function revalidateSupport(threadId?: string) {
  revalidatePath("/support");
  if (threadId) revalidatePath(`/support/${threadId}`);
  revalidatePath("/settings");
}

// --- Public API keys (owner only) ------------------------------------------------------

export async function createApiKeyAction(
  _prev: SupportActionResult | undefined,
  formData: FormData,
): Promise<SupportActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };
  if (ctx.role === "staff") return { ok: false, error: "Only the company owner can create API keys." };
  const name = String(formData.get("name") ?? "").trim().slice(0, 80) || "Support tool";

  const admin = createAdminClient();
  const { count } = await admin
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("client_id", ctx.clientId)
    .is("revoked_at", null);
  if ((count ?? 0) >= 10) return { ok: false, error: "At most 10 active API keys per workspace." };

  const generated = generateApiKey();
  const { error: insertError } = await admin.from("api_keys").insert({
    client_id: ctx.clientId,
    name,
    key_hash: generated.hash,
    key_prefix: generated.prefix,
    scopes: ["orders:read"],
  });
  if (insertError) return { ok: false, error: insertError.message };
  revalidateSupport();
  return { ok: true, apiKey: generated.key };
}

export async function revokeApiKeyAction(
  _prev: SupportActionResult | undefined,
  formData: FormData,
): Promise<SupportActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };
  if (ctx.role === "staff") return { ok: false, error: "Only the company owner can revoke API keys." };
  const id = String(formData.get("key_id") ?? "").trim();
  if (!id) return { ok: false, error: "Key is required." };
  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("client_id", ctx.clientId);
  if (updateError) return { ok: false, error: updateError.message };
  revalidateSupport();
  return { ok: true };
}

// --- Gmail mailbox ----------------------------------------------------------------------

export async function disconnectGmailAction(
  _prev: SupportActionResult | undefined,
  formData: FormData,
): Promise<SupportActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };
  if (ctx.role === "staff") return { ok: false, error: "Only the company owner can disconnect the mailbox." };
  const id = String(formData.get("mailbox_id") ?? "").trim();
  if (!id) return { ok: false, error: "Mailbox is required." };
  const admin = createAdminClient();
  // Threads/messages are kept for history; the token is dropped and the mailbox disabled.
  const { error: updateError } = await admin
    .from("support_mailboxes")
    .update({ enabled: false, refresh_token_encrypted: "", sync_error: null })
    .eq("id", id)
    .eq("client_id", ctx.clientId);
  if (updateError) return { ok: false, error: updateError.message };
  revalidateSupport();
  return { ok: true };
}

async function loadMailbox(clientId: string): Promise<MailboxRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("support_mailboxes")
    .select("id, client_id, email_address, refresh_token_encrypted, history_id, enabled")
    .eq("client_id", clientId)
    .eq("enabled", true)
    .limit(1)
    .maybeSingle<MailboxRow>();
  return data ?? null;
}

/** Owner or staff: pull the mailbox now instead of waiting for the 10-minute cron. */
export async function syncSupportNowAction(): Promise<SupportActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };
  const mailbox = await loadMailbox(ctx.clientId);
  if (!mailbox) return { ok: false, error: "No Gmail mailbox connected." };
  try {
    await syncMailbox(mailbox);
  } catch (syncError) {
    const message = syncError instanceof Error ? syncError.message : "Gmail sync failed.";
    await createAdminClient()
      .from("support_mailboxes")
      .update({ sync_error: message.slice(0, 500) })
      .eq("id", mailbox.id);
    return { ok: false, error: message };
  }
  revalidateSupport();
  return { ok: true };
}

// --- Threads ----------------------------------------------------------------------------

async function loadTenantThread(clientId: string, threadId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("support_threads")
    .select("id, mailbox_id, provider_thread_id, subject, status")
    .eq("id", threadId)
    .eq("client_id", clientId)
    .maybeSingle();
  return data ?? null;
}

export async function markThreadResolvedAction(
  _prev: SupportActionResult | undefined,
  formData: FormData,
): Promise<SupportActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };
  const threadId = String(formData.get("thread_id") ?? "").trim();
  const reopen = formData.get("reopen") === "1";
  const thread = await loadTenantThread(ctx.clientId, threadId);
  if (!thread) return { ok: false, error: "Thread not found." };
  const { error: updateError } = await createAdminClient()
    .from("support_threads")
    .update({ status: reopen ? "open" : "closed" })
    .eq("id", thread.id);
  if (updateError) return { ok: false, error: updateError.message };
  revalidateSupport(thread.id);
  return { ok: true };
}

/**
 * Sends the (edited) draft through Gmail, threaded with In-Reply-To / References, stores the
 * outbound message, links the draft to it and marks the thread "answered".
 */
export async function sendSupportReplyAction(
  _prev: SupportActionResult | undefined,
  formData: FormData,
): Promise<SupportActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };
  const threadId = String(formData.get("thread_id") ?? "").trim();
  const draftId = String(formData.get("draft_id") ?? "").trim() || null;
  const body = String(formData.get("body") ?? "").replace(/\r\n/g, "\n").trim();
  if (!body) return { ok: false, error: "Reply is empty." };
  if (body.length > 20_000) return { ok: false, error: "Reply is too long (20k characters max)." };

  const thread = await loadTenantThread(ctx.clientId, threadId);
  if (!thread) return { ok: false, error: "Thread not found." };
  const admin = createAdminClient();
  const { data: mailbox } = await admin
    .from("support_mailboxes")
    .select("id, client_id, email_address, refresh_token_encrypted, history_id, enabled")
    .eq("id", thread.mailbox_id)
    .maybeSingle<MailboxRow>();
  if (!mailbox?.enabled || !mailbox.refresh_token_encrypted) {
    return { ok: false, error: "The Gmail mailbox is disconnected." };
  }

  // Latest inbound message gives the recipient (Reply-To / From) and the RFC Message-ID.
  const { data: lastInbound } = await admin
    .from("support_messages")
    .select("id, provider_message_id, rfc_message_id")
    .eq("thread_id", thread.id)
    .eq("direction", "in")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastInbound) return { ok: false, error: "No customer message to reply to." };
  const { data: rfcRows } = await admin
    .from("support_messages")
    .select("rfc_message_id")
    .eq("thread_id", thread.id)
    .not("rfc_message_id", "is", null)
    .order("received_at", { ascending: true });
  const references = (rfcRows ?? []).map((r) => r.rfc_message_id).filter(Boolean).join(" ") || null;

  try {
    const accessToken = await refreshGmailAccessToken(mailbox.refresh_token_encrypted);
    // The recipient is re-read from Gmail (we never store the customer e-mail).
    const original = await fetchGmailMessage(accessToken, lastInbound.provider_message_id, mailbox.email_address);
    if (!original.replyTo) return { ok: false, error: "Could not determine the customer address." };
    const sent = await sendGmailReply(accessToken, {
      from: mailbox.email_address,
      to: original.replyTo,
      subject: thread.subject ?? original.subject ?? "",
      body,
      threadId: thread.provider_thread_id,
      inReplyTo: lastInbound.rfc_message_id ?? original.rfcMessageId,
      references,
    });
    const now = new Date().toISOString();
    const { data: saved, error: insertError } = await admin
      .from("support_messages")
      .upsert(
        {
          thread_id: thread.id,
          provider_message_id: sent.id,
          direction: "out",
          from_name: null,
          from_email_hash: null,
          body_text: body,
          received_at: now,
          is_draft: false,
          sent_at: now,
          rfc_message_id: sent.rfcMessageId,
        },
        { onConflict: "provider_message_id" },
      )
      .select("id")
      .single();
    if (insertError) throw insertError;
    if (draftId) {
      await admin
        .from("support_drafts")
        .update({ approved_at: now, sent_message_id: saved?.id ?? null, body_text: body })
        .eq("id", draftId)
        .eq("thread_id", thread.id);
    }
    await admin
      .from("support_threads")
      .update({ status: "answered", last_message_at: now, last_direction: "out", snippet: body.slice(0, 200) })
      .eq("id", thread.id);
  } catch (sendError) {
    return { ok: false, error: sendError instanceof Error ? sendError.message : "Gmail send failed." };
  }
  revalidateSupport(thread.id);
  return { ok: true };
}
