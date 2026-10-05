import "server-only";

import { createOAuthState, parseOAuthState } from "@/lib/oauth/state";
import { decryptSupportToken } from "./crypto";
import { buildReplyRaw, parseGmailMessage, type GmailMessage, type ParsedGmailMessage } from "./gmail-parse";

/**
 * Gmail REST client for SAV Lite. One refresh token per mailbox (stored encrypted);
 * access tokens are minted per sync and never persisted.
 *
 * Scope: https://www.googleapis.com/auth/gmail.modify (read + send + labels; the smallest
 * single scope that covers listing, reading and replying).
 */

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailOAuthState = { clientId: string; locale: "fr" | "en" };

export function isGmailConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

function clientId() {
  const value = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!value) throw new Error("GOOGLE_CLIENT_ID is not configured.");
  return value;
}

function clientSecret() {
  const value = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!value) throw new Error("GOOGLE_CLIENT_SECRET is not configured.");
  return value;
}

export function gmailRedirectUri(appUrl: string) {
  return `${appUrl.replace(/\/$/, "")}/api/support/gmail/callback`;
}

export function createGmailState(payload: GmailOAuthState) {
  return createOAuthState(clientSecret(), payload);
}

export function parseGmailState(value: string | null) {
  return parseOAuthState<GmailOAuthState>(clientSecret(), value);
}

export function buildGmailAuthorizeUrl(input: { appUrl: string; state: GmailOAuthState }) {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: gmailRedirectUri(input.appUrl),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: createGmailState(input.state),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function tokenRequest(body: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Google token endpoint returned ${response.status}.`);
  }
  return data;
}

export async function exchangeGmailCode(code: string, appUrl: string) {
  const data = await tokenRequest({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: gmailRedirectUri(appUrl),
    grant_type: "authorization_code",
  });
  if (!data.refresh_token) {
    throw new Error("Google did not return a refresh token — remove the app from the Google account and retry.");
  }
  return { accessToken: data.access_token!, refreshToken: data.refresh_token };
}

export async function refreshGmailAccessToken(refreshTokenEncrypted: string) {
  const data = await tokenRequest({
    refresh_token: decryptSupportToken(refreshTokenEncrypted),
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: "refresh_token",
  });
  return data.access_token!;
}

async function gmailFetch<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(`Gmail ${path} → ${response.status} ${text.slice(0, 200)}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

export async function getGmailProfile(accessToken: string) {
  return gmailFetch<{ emailAddress: string; historyId: string }>(accessToken, "/profile");
}

/**
 * Message ids to fetch: incremental via history.list when a history_id is known (falls back
 * to a 7-day listing when Google says the id is too old → 404), else the last 7 days.
 */
export async function listNewGmailMessageIds(
  accessToken: string,
  historyId: string | null,
): Promise<{ ids: string[]; historyId: string }> {
  if (historyId) {
    try {
      const ids = new Set<string>();
      let pageToken: string | undefined;
      let latest = historyId;
      do {
        const params = new URLSearchParams({ startHistoryId: historyId, historyTypes: "messageAdded", maxResults: "500" });
        if (pageToken) params.set("pageToken", pageToken);
        const page = await gmailFetch<{
          historyId?: string;
          nextPageToken?: string;
          history?: Array<{ messagesAdded?: Array<{ message: { id: string; labelIds?: string[] } }> }>;
        }>(accessToken, `/history?${params.toString()}`);
        for (const entry of page.history ?? []) {
          for (const added of entry.messagesAdded ?? []) {
            const labels = added.message.labelIds ?? [];
            if (labels.includes("DRAFT") || labels.includes("SPAM") || labels.includes("TRASH")) continue;
            ids.add(added.message.id);
          }
        }
        if (page.historyId) latest = page.historyId;
        pageToken = page.nextPageToken;
      } while (pageToken);
      return { ids: [...ids], historyId: latest };
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
      // history id expired → full listing below
    }
  }
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q: "newer_than:7d -in:spam -in:trash -in:drafts", maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await gmailFetch<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
      accessToken,
      `/messages?${params.toString()}`,
    );
    ids.push(...(page.messages ?? []).map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < 500);
  const profile = await getGmailProfile(accessToken);
  return { ids, historyId: profile.historyId };
}

export async function fetchGmailMessage(
  accessToken: string,
  id: string,
  mailboxEmail: string,
): Promise<ParsedGmailMessage> {
  const message = await gmailFetch<GmailMessage>(accessToken, `/messages/${id}?format=full`);
  return parseGmailMessage(message, mailboxEmail);
}

/** Sends a threaded reply; returns the Gmail message id + RFC Message-ID of the sent mail. */
export async function sendGmailReply(
  accessToken: string,
  input: {
    from: string;
    to: string;
    subject: string;
    body: string;
    threadId: string;
    inReplyTo: string | null;
    references: string | null;
  },
) {
  const raw = buildReplyRaw(input);
  const sent = await gmailFetch<{ id: string; threadId: string }>(accessToken, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw, threadId: input.threadId }),
  });
  const meta = await gmailFetch<GmailMessage>(
    accessToken,
    `/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`,
  ).catch(() => null);
  const rfcMessageId =
    meta?.payload?.headers?.find((h) => h.name.toLowerCase() === "message-id")?.value ?? null;
  return { id: sent.id, threadId: sent.threadId, rfcMessageId };
}
