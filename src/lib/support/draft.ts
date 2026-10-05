/**
 * AI reply drafts for SAV Lite. `buildDraftPrompt` is pure (tested without network);
 * `generateSupportDraft` calls the Anthropic Messages API through createJsonMessage.
 */

import { createJsonMessage, isAssistantConfigured } from "../ai/anthropic";
import type { PublicFulfillmentStatus } from "../public-api/orders";
import { detectLanguage } from "./match";

export const SUPPORT_INTENTS = ["where_is_my_order", "delivery_delay", "damaged", "return", "other"] as const;
export type SupportIntent = (typeof SUPPORT_INTENTS)[number];

export type DraftOrderContext = {
  number: string | null;
  placedAt: string | null;
  status: PublicFulfillmentStatus;
  carrier: string | null;
  service: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  /** Delivery promise from the accepted quote(s), e.g. "6–10 jours". */
  eta: string | null;
  items: Array<{ sku: string; title: string | null; qty: number }>;
};

export type DraftInput = {
  storeName: string;
  customerName: string | null;
  subject: string;
  message: string;
  order: DraftOrderContext | null;
  /** Earlier messages of the thread, oldest first (customer + store). */
  history?: Array<{ direction: "in" | "out"; text: string }>;
  language?: "fr" | "en";
};

export type DraftOutput = {
  intent: SupportIntent;
  confidence: number;
  language: "fr" | "en";
  reply: string;
};

export function signatureFor(storeName: string, language: "fr" | "en") {
  return language === "fr" ? `L'équipe ${storeName}` : `The ${storeName} team`;
}

function statusLabel(status: PublicFulfillmentStatus, language: "fr" | "en") {
  const fr: Record<PublicFulfillmentStatus, string> = {
    received: "commande reçue, en attente de préparation à l'entrepôt",
    preparing: "en cours de préparation à l'entrepôt",
    shipped: "expédiée",
    delivered: "livrée",
    cancelled: "annulée",
    unknown: "en cours de vérification par l'entrepôt",
  };
  const en: Record<PublicFulfillmentStatus, string> = {
    received: "received, waiting to be prepared at the warehouse",
    preparing: "being prepared at the warehouse",
    shipped: "shipped",
    delivered: "delivered",
    cancelled: "cancelled",
    unknown: "being checked by the warehouse",
  };
  return (language === "fr" ? fr : en)[status];
}

/** System prompt + user content for createJsonMessage. Pure. */
export function buildDraftPrompt(input: DraftInput) {
  const language = input.language ?? detectLanguage(`${input.subject}\n${input.message}`);
  const signature = signatureFor(input.storeName, language);
  const order = input.order;
  const orderBlock = order
    ? [
        `Matched order: #${order.number ?? "?"}`,
        `Placed at: ${order.placedAt ?? "unknown"}`,
        `Status: ${order.status} (${statusLabel(order.status, language)})`,
        `Carrier: ${order.carrier ?? "unknown"}${order.service ? ` · service ${order.service}` : ""}`,
        `Tracking number: ${order.trackingNumber ?? "NONE YET"}`,
        `Tracking URL: ${order.trackingUrl ?? "NONE YET"}`,
        `Shipped at: ${order.shippedAt ?? "not shipped yet"}`,
        `Delivery estimate after shipping: ${order.eta ?? "unknown"}`,
        `Items: ${order.items.map((i) => `${i.qty}× ${i.title ?? i.sku}`).join(", ") || "unknown"}`,
      ].join("\n")
    : "Matched order: NONE — the order could not be identified from the e-mail.";

  const system = [
    `You are the customer-support assistant of the online store "${input.storeName}".`,
    `Write the reply in ${language === "fr" ? "French (vouvoiement)" : "English"}: warm, concise, professional, 4 to 10 sentences, plain text, no markdown.`,
    `Sign exactly with: "${signature}" on the last line.`,
    "Hard rules:",
    "- NEVER invent a tracking number, a carrier, a date or a refund. Only use the order facts below; if a fact is NONE/unknown, say it is not available yet.",
    "- If no order is matched, politely ask the customer for their order number (format #1234) and the e-mail used at checkout, and do not guess any order detail.",
    "- If the tracking URL exists, include it verbatim.",
    "- For a damaged parcel or a return, ask for photos / confirm the store will come back with the procedure; do not promise a refund amount.",
    "- Do not mention Voltship, the warehouse provider or any internal reference; speak as the store.",
    "Classify the request: where_is_my_order | delivery_delay | damaged | return | other.",
    'Return JSON: {"intent": string, "confidence": number 0-1, "language": "fr"|"en", "reply": string}.',
  ].join("\n");

  const history = (input.history ?? [])
    .slice(-6)
    .map((m) => `[${m.direction === "in" ? "customer" : "store"}] ${m.text.slice(0, 1_500)}`)
    .join("\n\n");

  const user = [
    `Customer name: ${input.customerName ?? "unknown"}`,
    `Subject: ${input.subject || "(no subject)"}`,
    "",
    orderBlock,
    history ? `\nEarlier messages:\n${history}` : "",
    "",
    "Latest customer message:",
    input.message.slice(0, 6_000),
  ].join("\n");

  return { system, user, language, signature };
}

export function isSupportIntent(value: unknown): value is SupportIntent {
  return typeof value === "string" && (SUPPORT_INTENTS as readonly string[]).includes(value);
}

/** Normalises the model JSON; enforces the signature and the no-invented-tracking rule. */
export function normalizeDraftOutput(
  raw: unknown,
  fallback: { language: "fr" | "en"; signature: string; trackingNumber: string | null },
): DraftOutput | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  let reply = typeof row.reply === "string" ? row.reply.trim() : "";
  if (!reply) return null;
  const language = row.language === "en" || row.language === "fr" ? row.language : fallback.language;
  if (!reply.includes(fallback.signature)) reply = `${reply}\n\n${fallback.signature}`;
  // Guard: a tracking-looking code that is not the order's own number is dropped.
  if (!fallback.trackingNumber) {
    reply = reply.replace(/\b(?=[A-Z0-9]{12,34}\b)(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]+\b/g, "[…]");
  }
  const confidence = Number(row.confidence);
  return {
    intent: isSupportIntent(row.intent) ? row.intent : "other",
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
    language,
    reply,
  };
}

/** Null when ANTHROPIC_API_KEY is missing (thread is still listed, just without a draft). */
export async function generateSupportDraft(input: DraftInput): Promise<DraftOutput | null> {
  if (!isAssistantConfigured()) return null;
  const prompt = buildDraftPrompt(input);
  const result = await createJsonMessage<Record<string, unknown>>({
    system: prompt.system,
    inputs: [{ type: "text", text: prompt.user }],
    maxTokens: 1_200,
    temperature: 0.2,
  });
  return normalizeDraftOutput(result.json, {
    language: prompt.language,
    signature: prompt.signature,
    trackingNumber: input.order?.trackingNumber ?? null,
  });
}
