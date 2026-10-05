/**
 * Pure Gmail message parsing (users.messages.get format=full) → SupportInboundMessage.
 * No network: tested with a fixture in gmail-parse.test.ts.
 */

import { hashCustomerEmail } from "../shopify/order-cache";

export const MAX_BODY_CHARS = 20_000;

export type GmailHeader = { name: string; value: string };

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};

export type ParsedGmailMessage = {
  providerMessageId: string;
  providerThreadId: string;
  direction: "in" | "out";
  subject: string;
  fromName: string | null;
  fromEmail: string;
  fromEmailHash: string | null;
  /** Reply-To wins over From when set (used as the recipient of our reply). */
  replyTo: string;
  rfcMessageId: string | null;
  references: string | null;
  bodyText: string;
  snippet: string;
  receivedAt: string;
};

export function header(headers: GmailHeader[] | undefined, name: string) {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value?.trim() || null;
}

/** "Jane Doe <jane@example.com>" / "jane@example.com" / "\"Doe, Jane\" <jane@x>" → parts. */
export function parseAddress(raw: string | null | undefined) {
  const value = (raw ?? "").trim();
  if (!value) return { name: null, email: "" };
  const match = /^(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(value);
  if (match) {
    return { name: match[1]?.trim().replace(/^"|"$/g, "") || null, email: match[2].trim().toLowerCase() };
  }
  return { name: null, email: value.toLowerCase() };
}

export function decodeBase64Url(data: string | undefined) {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** Very small HTML → text: strips tags/scripts, decodes a few entities, keeps line breaks. */
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectParts(part: GmailPart | undefined, out: GmailPart[] = []) {
  if (!part) return out;
  out.push(part);
  for (const child of part.parts ?? []) collectParts(child, out);
  return out;
}

/** Prefers text/plain, falls back to text/html → text. Trimmed to MAX_BODY_CHARS. */
export function extractBodyText(payload: GmailPart | undefined) {
  const parts = collectParts(payload);
  const plain = parts.find((p) => p.mimeType === "text/plain" && p.body?.data && !p.filename);
  let text = plain ? decodeBase64Url(plain.body?.data) : "";
  if (!text.trim()) {
    const html = parts.find((p) => p.mimeType === "text/html" && p.body?.data && !p.filename);
    if (html) text = htmlToText(decodeBase64Url(html.body?.data));
  }
  return text.replace(/\r\n/g, "\n").trim().slice(0, MAX_BODY_CHARS);
}

/** Drops the quoted previous messages ("On … wrote:", "Le … a écrit :", "> " lines). */
export function stripQuotedReply(text: string) {
  const lines = text.split("\n");
  const cut = lines.findIndex(
    (line) =>
      /^(On .+ wrote:|Le .+ a écrit\s?:|-{2,}\s*Original Message\s*-{2,}|_{5,}|De\s?:\s.+|From:\s.+)$/i.test(line.trim()),
  );
  const kept = (cut === -1 ? lines : lines.slice(0, cut)).filter((line) => !line.startsWith(">"));
  return kept.join("\n").trim() || text.trim();
}

export function parseGmailMessage(message: GmailMessage, mailboxEmail: string): ParsedGmailMessage {
  const headers = message.payload?.headers;
  const from = parseAddress(header(headers, "From"));
  const replyTo = parseAddress(header(headers, "Reply-To"));
  const labels = message.labelIds ?? [];
  const direction: "in" | "out" =
    labels.includes("SENT") || (from.email && from.email === mailboxEmail.toLowerCase()) ? "out" : "in";
  const internal = Number(message.internalDate);
  const dateHeader = header(headers, "Date");
  const receivedAt = Number.isFinite(internal) && internal > 0
    ? new Date(internal).toISOString()
    : dateHeader && !Number.isNaN(new Date(dateHeader).getTime())
      ? new Date(dateHeader).toISOString()
      : new Date().toISOString();
  const body = extractBodyText(message.payload);
  return {
    providerMessageId: message.id,
    providerThreadId: message.threadId,
    direction,
    subject: header(headers, "Subject") ?? "",
    fromName: from.name,
    fromEmail: from.email,
    fromEmailHash: hashCustomerEmail(from.email),
    replyTo: replyTo.email || from.email,
    rfcMessageId: header(headers, "Message-ID") ?? header(headers, "Message-Id"),
    references: header(headers, "References"),
    bodyText: direction === "in" ? stripQuotedReply(body) : body,
    snippet: (message.snippet ?? body).slice(0, 200),
    receivedAt,
  };
}

/** Builds the RFC 2822 reply and returns its base64url encoding for users.messages.send. */
export function buildReplyRaw(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string | null;
  references?: string | null;
}) {
  const subject = /^re:/i.test(input.subject.trim()) ? input.subject.trim() : `Re: ${input.subject.trim()}`;
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const refs = [input.references, input.inReplyTo].filter(Boolean).join(" ").trim();
  const lines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  if (input.inReplyTo) lines.push(`In-Reply-To: ${input.inReplyTo}`);
  if (refs) lines.push(`References: ${refs}`);
  const raw = `${lines.join("\r\n")}\r\n\r\n${Buffer.from(input.body, "utf8").toString("base64")}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}
