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
] as const;
export type OrderAlertReason = (typeof ORDER_ALERT_REASONS)[number];

/** Discount ≥ 60 % of the products' price. */
export const DISCOUNT_ABUSE_SHARE = 0.6;
/** 10 units or more in one order (Voltship stores average ~1.1 unit per order). */
export const QUANTITY_SPIKE_UNITS = 10;

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
};

export type OrderAnomalyDetails = {
  total: number | null;
  gross: number | null;
  discounts: number | null;
  discount_pct: number | null;
  discount_codes: string[];
  units: number;
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

  return {
    reasons,
    details: {
      total,
      gross,
      discounts,
      discount_pct: discountPct,
      discount_codes: codes,
      units,
    },
  };
}

export function parseAlertReasons(value: unknown): OrderAlertReason[] {
  if (!Array.isArray(value)) return [];
  return value.filter((reason): reason is OrderAlertReason =>
    (ORDER_ALERT_REASONS as readonly string[]).includes(String(reason)),
  );
}
