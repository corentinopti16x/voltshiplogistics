/**
 * Pure order matching for SAV Lite: pulls order numbers / warehouse references / tracking
 * numbers out of a customer e-mail and picks the best cached order. Tested in match.test.ts.
 */

export type MatchableOrder = {
  id: string;
  order_number: string | null;
  shopify_order_id: string;
  placed_at: string | null;
  order_date: string;
  customer_key: string | null;
  customer_email_key: string | null;
};

export type ExtractedRefs = {
  orderNumbers: string[];
  warehouseRefs: string[];
  trackingNumbers: string[];
};

const ORDER_WORDS =
  /(?:commande|order|n[°º]|no\.?|num(?:é|e)ro|#|ref(?:erence)?\.?|bestellung|pedido)\s*[:#]?\s*#?\s*(\d{3,8})\b/gi;

/** "#1234", "commande 1234", "order no. 1234", "VS-ACME-1234", tracking-looking codes. */
export function extractReferences(text: string): ExtractedRefs {
  const source = text ?? "";
  const orderNumbers = new Set<string>();
  const warehouseRefs = new Set<string>();
  const trackingNumbers = new Set<string>();

  for (const match of source.matchAll(/VS-[A-Z0-9]+(?:-[A-Z0-9]+)*-(\d{1,8})\b/gi)) {
    warehouseRefs.add(match[0].toUpperCase());
    orderNumbers.add(match[1]);
  }
  for (const match of source.matchAll(/#\s?(\d{3,8})\b/g)) orderNumbers.add(match[1]);
  for (const match of source.matchAll(ORDER_WORDS)) orderNumbers.add(match[1]);
  // Tracking numbers: ≥ 10 chars, letters+digits mixes (YT2024…, LX123456789FR, 1Z…) or long digit runs.
  for (const match of source.matchAll(/\b(?=[A-Z0-9]{10,34}\b)(?=[A-Z0-9]*\d)[A-Z0-9]+\b/g)) {
    const candidate = match[0];
    if (/^\d+$/.test(candidate) && candidate.length < 12) continue;
    if (/^VS-/.test(candidate)) continue;
    trackingNumbers.add(candidate);
  }
  return {
    orderNumbers: [...orderNumbers],
    warehouseRefs: [...warehouseRefs],
    trackingNumbers: [...trackingNumbers],
  };
}

function placedTime(order: MatchableOrder) {
  const value = order.placed_at ? new Date(order.placed_at).getTime() : new Date(order.order_date).getTime();
  return Number.isFinite(value) ? value : 0;
}

export type MatchResult = {
  order: MatchableOrder | null;
  /** number: explicit order number in the text · email: most recent order of that customer · none */
  by: "number" | "email" | "none";
  refs: ExtractedRefs;
};

/**
 * 1. An explicit order number in subject/body that belongs to this customer (or to the
 *    tenant when the e-mail hash is unknown) wins.
 * 2. Else the most recent order whose customer_email_key / customer_key equals the sender hash.
 */
export function matchOrder(input: {
  subject: string | null | undefined;
  body: string | null | undefined;
  senderEmailHash: string | null;
  orders: MatchableOrder[];
}): MatchResult {
  const refs = extractReferences(`${input.subject ?? ""}\n${input.body ?? ""}`);
  const sorted = [...input.orders].sort((a, b) => placedTime(b) - placedTime(a));
  const ofSender = input.senderEmailHash
    ? sorted.filter(
        (o) => o.customer_email_key === input.senderEmailHash || o.customer_key === input.senderEmailHash,
      )
    : [];

  for (const number of refs.orderNumbers) {
    const own = ofSender.find((o) => o.order_number === number);
    if (own) return { order: own, by: "number", refs };
  }
  for (const number of refs.orderNumbers) {
    const any = sorted.find((o) => o.order_number === number);
    if (any) return { order: any, by: "number", refs };
  }
  if (ofSender.length > 0) return { order: ofSender[0], by: "email", refs };
  return { order: null, by: "none", refs };
}

/** Cheap FR/EN detection on the customer text (defaults to FR for Voltship's base). */
export function detectLanguage(text: string): "fr" | "en" {
  const sample = (text ?? "").toLowerCase();
  const fr = (sample.match(/\b(bonjour|merci|commande|colis|livraison|je|pas|vous|mon|ma|est|pour|avec|reçu|où)\b/g) ?? []).length;
  const en = (sample.match(/\b(hello|hi|thanks|thank|order|parcel|package|delivery|my|the|is|not|where|have|received)\b/g) ?? []).length;
  if (en > fr) return "en";
  return "fr";
}
