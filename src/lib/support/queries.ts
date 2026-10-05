import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { SupportIntent } from "./draft";

export type SupportThreadRow = {
  id: string;
  subject: string | null;
  customer_name: string | null;
  status: "open" | "answered" | "closed";
  matched_order_number: string | null;
  matched_order_id: string | null;
  last_message_at: string | null;
  last_direction: "in" | "out" | null;
  snippet: string | null;
  created_at: string;
};

export type SupportMessageRow = {
  id: string;
  direction: "in" | "out";
  from_name: string | null;
  body_text: string;
  received_at: string;
  sent_at: string | null;
};

export type SupportDraftRow = {
  id: string;
  body_text: string;
  intent: SupportIntent;
  confidence: number | null;
  generated_at: string;
  approved_at: string | null;
  sent_message_id: string | null;
};

export type MailboxSummary = {
  id: string;
  email_address: string;
  enabled: boolean;
  last_sync_at: string | null;
  sync_error: string | null;
  created_at: string;
};

export type ApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const THREAD_COLUMNS =
  "id, subject, customer_name, status, matched_order_number, matched_order_id, last_message_at, last_direction, snippet, created_at";

export async function listSupportThreads(clientId: string, limit = 100) {
  const admin = createAdminClient();
  const { data: threads } = await admin
    .from("support_threads")
    .select(THREAD_COLUMNS)
    .eq("client_id", clientId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit)
    .returns<SupportThreadRow[]>();
  const rows = threads ?? [];
  if (rows.length === 0) return [] as Array<SupportThreadRow & { intent: SupportIntent | null }>;
  const { data: drafts } = await admin
    .from("support_drafts")
    .select("thread_id, intent, generated_at")
    .in("thread_id", rows.map((t) => t.id))
    .order("generated_at", { ascending: false });
  const intentByThread = new Map<string, SupportIntent>();
  for (const draft of drafts ?? []) {
    if (!intentByThread.has(draft.thread_id)) intentByThread.set(draft.thread_id, draft.intent as SupportIntent);
  }
  return rows.map((row) => ({ ...row, intent: intentByThread.get(row.id) ?? null }));
}

export async function getSupportThread(clientId: string, threadId: string) {
  const admin = createAdminClient();
  const { data: thread } = await admin
    .from("support_threads")
    .select(THREAD_COLUMNS)
    .eq("client_id", clientId)
    .eq("id", threadId)
    .maybeSingle<SupportThreadRow>();
  if (!thread) return null;
  const [{ data: messages }, { data: drafts }] = await Promise.all([
    admin
      .from("support_messages")
      .select("id, direction, from_name, body_text, received_at, sent_at")
      .eq("thread_id", threadId)
      .order("received_at", { ascending: true })
      .returns<SupportMessageRow[]>(),
    admin
      .from("support_drafts")
      .select("id, body_text, intent, confidence, generated_at, approved_at, sent_message_id")
      .eq("thread_id", threadId)
      .is("sent_message_id", null)
      .order("generated_at", { ascending: false })
      .limit(1)
      .returns<SupportDraftRow[]>(),
  ]);
  return { thread, messages: messages ?? [], draft: drafts?.[0] ?? null };
}

export async function getMailbox(clientId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("support_mailboxes")
    .select("id, email_address, enabled, last_sync_at, sync_error, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<MailboxSummary>();
  return data ?? null;
}

export async function listApiKeys(clientId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("api_keys")
    .select("id, name, key_prefix, scopes, created_at, last_used_at, revoked_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .returns<ApiKeyRow[]>();
  return data ?? [];
}

/** Admin summary line: Gmail connected? + open ticket count. */
export async function supportSummary(clientId: string) {
  const admin = createAdminClient();
  const [{ data: mailbox }, { count }] = await Promise.all([
    admin
      .from("support_mailboxes")
      .select("email_address, enabled, sync_error")
      .eq("client_id", clientId)
      .eq("enabled", true)
      .limit(1)
      .maybeSingle(),
    admin
      .from("support_threads")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "open"),
  ]);
  return { mailbox: mailbox ?? null, openTickets: count ?? 0 };
}
