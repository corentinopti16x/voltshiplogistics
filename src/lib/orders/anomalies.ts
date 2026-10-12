import { isSuspiciousOrder } from "../shopify/order-cache";

/**
 * Commandes à vérifier. Pure rules, shared by the Shopify webhook and the backfill.
 * Only `price_anomaly` takes the order out of the sales by itself (see isSuspiciousOrder);
 * the other reasons just ask Voltship and the client to take a look.
 */
export const ORDER_ALERT_REASONS = [
  "price_anomaly",
  "zero_total",
  "discount_abuse",
  "quantity_spike",
  "gift_abuse",
] as const;
export type OrderAlertReason = (typeof ORDER_ALERT_REASONS)[number];

/** Discount ≥ 60 % of the products' price. */
export const DISCOUNT_ABUSE_SHARE = 0.6;
/** 10 units or more in one order (Voltship stores average ~1.1 unit per order). */
export const QUANTITY_SPIKE_UNITS = 10;

/** Free gift line: « FREE », « GRATIS », « offert », « cadeau »… in its title, or a 0 € line. */
const GIFT_TITLE = /\b(free|gratis|gratuit|gratuite|gratuits|offert|offerte|offerts|cadeau|cadeaux|gift|regalo)\b/i;

export function isGiftLine(line: { title?: string | null; name?: string | null; price?: unknown }) {
  if (GIFT_TITLE.test(`${line.title ?? ""} ${line.name ?? ""}`)) return true;
  return amount(line.price) === 0;
}

export const ORDER_ALERT_LABELS: Record<OrderAlertReason, { title: string; help: string }> = {
  price_anomaly: {
    title: "Prix anormal",
    help: "Beaucoup d'articles pour presque rien payé (moins de 1 € par article). Commande sortie des ventes en attendant.",
  },
  zero_total: {
    title: "Commande à 0 €",
    help: "Le client n'a rien payé : cadeau, influenceur, test… ou code promo à 100 %.",
  },
  discount_abuse: {
    title: "Grosse remise",
    help: "Au moins 60 % de remise sur les produits : code promo partagé ou mal réglé ?",
  },
  quantity_spike: {
    title: "Quantité inhabituelle",
    help: "10 articles ou plus dans une seule commande.",
  },
  gift_abuse: {
    title: "Cadeau en trop",
    help: "Article offert en quantité 2 ou plus, ou plus d'articles offerts que de produits payés : la quantité du cadeau est à bloquer à 1 dans la boutique. On expédie la quantité prévue par l'offre.",
  },
};

export type OrderAnomalyInput = {
  /** Amount paid (Shopify total_price). */
  total: unknown;
  /** Products before discounts (Shopify total_line_items_price). */
  gross?: unknown;
  /** Shopify total_discounts. */
  discounts?: unknown;
  discountCodes?: Array<{ code?: string | null } | string> | null;
  units: number;
  /** Order lines, to spot free gifts taken several times. */
  lines?: Array<{ title?: string | null; name?: string | null; price?: unknown; quantity?: unknown }> | null;
};

export type OrderAnomalyDetails = {
  total: number | null;
  gross: number | null;
  discounts: number | null;
  discount_pct: number | null;
  discount_codes: string[];
  units: number;
  /** Units of free gift lines / of paid lines (when the lines were given). */
  gift_units?: number;
  paid_units?: number;
};

function amount(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function detectOrderAnomalies(input: OrderAnomalyInput): {
  reasons: OrderAlertReason[];
  details: OrderAnomalyDetails;
} {
  const total = amount(input.total);
  const gross = amount(input.gross);
  const discounts = amount(input.discounts);
  const units = Number.isFinite(input.units) ? input.units : 0;
  const discountPct =
    gross != null && gross > 0 && discounts != null ? Math.round((discounts / gross) * 1000) / 10 : null;
  const codes = (input.discountCodes ?? [])
    .map((entry) => (typeof entry === "string" ? entry : entry?.code ?? ""))
    .map((code) => code.trim())
    .filter(Boolean);

  const reasons: OrderAlertReason[] = [];
  if (units > 0 && isSuspiciousOrder(total, units)) reasons.push("price_anomaly");
  else if (units > 0 && total === 0) reasons.push("zero_total");
  if (discountPct != null && discountPct >= DISCOUNT_ABUSE_SHARE * 100 && !reasons.includes("zero_total")) {
    reasons.push("discount_abuse");
  }
  if (units >= QUANTITY_SPIKE_UNITS) reasons.push("quantity_spike");

  let giftUnits: number | undefined;
  let paidUnits: number | undefined;
  if (input.lines && input.lines.length > 0) {
    giftUnits = 0;
    paidUnits = 0;
    let biggestGift = 0;
    for (const line of input.lines) {
      const quantity = Math.max(0, Number(line.quantity) || 0);
      if (isGiftLine(line)) {
        giftUnits += quantity;
        biggestGift = Math.max(biggestGift, quantity);
      } else {
        paidUnits += quantity;
      }
    }
    if (giftUnits > 0 && (biggestGift >= 2 || giftUnits > paidUnits)) reasons.push("gift_abuse");
  }

  return {
    reasons,
    details: {
      total,
      gross,
      discounts,
      discount_pct: discountPct,
      discount_codes: codes,
      units,
      ...(giftUnits != null ? { gift_units: giftUnits, paid_units: paidUnits } : {}),
    },
  };
}

export function parseAlertReasons(value: unknown): OrderAlertReason[] {
  if (!Array.isArray(value)) return [];
  return value.filter((reason): reason is OrderAlertReason =>
    (ORDER_ALERT_REASONS as readonly string[]).includes(String(reason)),
  );
}
