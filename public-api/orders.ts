/**
 * Pure shaping for the public tracking API (GET /api/public/v1/orders/…).
 * No I/O: everything here is unit-tested with fixtures (orders.test.ts).
 */

import { unpackOrderLines } from "../shopify/order-cache";

export type PublicFulfillmentStatus =
  | "received"
  | "preparing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "unknown";

/** Cached Shopify order row (shopify_orders_cache). */
export type CachedOrder = {
  id: string;
  shopify_order_id: string;
  order_number: string | null;
  placed_at: string | null;
  order_date: string;
  cancelled: boolean;
  line_items_json: unknown;
  customer_key: string | null;
  customer_email_key: string | null;
  shop_domain?: string | null;
};

/** Warehouse row (eccang_orders) for that order, when it was pushed. */
export type WarehouseOrder = {
  reference_no: string;
  status: string;
  tracking_no: string | null;
  carrier_code: string | null;
  shipping_method: string | null;
  shipped_at: string | null;
  billed_weight_g: number | null;
  updated_at: string | null;
};

/**
 * ECCANG order status → public status.
 * pending / C (awaiting review) → received · W (awaiting shipment) / H (held) → preparing ·
 * D → shipped · X → cancelled · N / P (abnormal / problem) → unknown (the warehouse is on it).
 * Without a warehouse row: Shopify "fulfilled" → shipped, else received.
 * "delivered" is reserved for carrier delivery events (not tracked yet).
 */
export function publicFulfillmentStatus(input: {
  cancelled: boolean;
  shopifyFulfilled: boolean | null;
  eccangStatus: string | null | undefined;
}): PublicFulfillmentStatus {
  if (input.cancelled) return "cancelled";
  const code = (input.eccangStatus ?? "").trim().toUpperCase();
  switch (code) {
    case "X":
      return "cancelled";
    case "D":
      return "shipped";
    case "W":
    case "H":
      return "preparing";
    case "N":
    case "P":
      return "unknown";
    case "C":
    case "PENDING":
      return "received";
    default:
      return input.shopifyFulfilled ? "shipped" : "received";
  }
}

const TRACKING_URLS: Array<[RegExp, (n: string) => string]> = [
  [/yun\s*express|^ye\b|yunexpress/i, (n) => `https://www.yuntrack.com/parcelTracking?id=${n}`],
  [/yanwen/i, (n) => `https://track.yw56.com.cn/en/querydel?nums=${n}`],
  [/4px/i, (n) => `https://track.4px.com/#/result/0/${n}`],
  [/cainiao/i, (n) => `https://global.cainiao.com/detail.htm?mailNoList=${n}`],
  [/colissimo|la\s*poste/i, (n) => `https://www.laposte.fr/outils/suivre-vos-envois?code=${n}`],
  [/chronopost/i, (n) => `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${n}`],
  [/mondial\s*relay/i, (n) => `https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=${n}`],
  [/\bdhl\b/i, (n) => `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${n}`],
  [/\bups\b/i, (n) => `https://www.ups.com/track?tracknum=${n}`],
  [/fedex/i, (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`],
  [/\bdpd\b/i, (n) => `https://www.dpd.com/tracking?parcelNumber=${n}`],
  [/\bgls\b/i, (n) => `https://gls-group.eu/track?match=${n}`],
  [/\busps\b/i, (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`],
];

/** Carrier-specific tracking page, 17track as the universal fallback. Null without a number. */
export function trackingUrlFor(carrier: string | null | undefined, trackingNumber: string | null | undefined) {
  const number = trackingNumber?.trim();
  if (!number) return null;
  const encoded = encodeURIComponent(number);
  const haystack = `${carrier ?? ""}`;
  for (const [pattern, build] of TRACKING_URLS) {
    if (pattern.test(haystack)) return build(encoded);
  }
  return `https://t.17track.net/en#nums=${encoded}`;
}

export type PublicOrderResponse = {
  order: { number: string | null; placed_at: string | null; shop: string | null };
  fulfillment: {
    status: PublicFulfillmentStatus;
    shipped_at: string | null;
    carrier: string | null;
    service: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
    billed_weight_g: number | null;
    last_event_at: string | null;
  };
  items: Array<{ sku: string; title: string | null; qty: number }>;
  warehouse: { reference: string | null };
};

export function shapePublicOrder(
  order: CachedOrder,
  warehouse: WarehouseOrder | null,
  titlesBySku: Record<string, string> = {},
): PublicOrderResponse {
  const { fulfilled, lines } = unpackOrderLines(order.line_items_json);
  const status = publicFulfillmentStatus({
    cancelled: order.cancelled,
    shopifyFulfilled: fulfilled,
    eccangStatus: warehouse?.status ?? null,
  });
  const tracking = warehouse?.tracking_no?.trim() || null;
  return {
    order: {
      number: order.order_number,
      placed_at: order.placed_at ?? `${order.order_date}T00:00:00.000Z`,
      shop: order.shop_domain ?? null,
    },
    fulfillment: {
      status,
      shipped_at: warehouse?.shipped_at ?? null,
      carrier: warehouse?.carrier_code ?? null,
      service: warehouse?.shipping_method ?? null,
      tracking_number: tracking,
      tracking_url: trackingUrlFor(warehouse?.carrier_code, tracking),
      billed_weight_g: warehouse?.billed_weight_g ?? null,
      last_event_at: warehouse?.updated_at ?? order.placed_at ?? null,
    },
    items: lines.map((line) => ({
      sku: line.sku,
      title: line.title ?? titlesBySku[line.sku] ?? null,
      qty: line.quantity,
    })),
    warehouse: { reference: warehouse?.reference_no ?? null },
  };
}

export type OrderLookup =
  | { kind: "number"; value: string }
  | { kind: "reference"; value: string }
  | { kind: "shopify_id"; value: string }
  | { kind: "uuid"; value: string };

/**
 * "#1234" / "1234" → order number · "VS-ACME-1234" → warehouse reference ·
 * 13+ digit → Shopify order id · uuid → cache row id.
 */
export function parseOrderLookup(raw: string): OrderLookup | null {
  const value = decodeURIComponent(raw ?? "").trim();
  if (!value) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return { kind: "uuid", value: value.toLowerCase() };
  }
  if (/^VS-[A-Z0-9-]+$/i.test(value)) return { kind: "reference", value: value.toUpperCase() };
  const digits = value.replace(/^#/, "");
  if (/^\d{12,}$/.test(digits)) return { kind: "shopify_id", value: digits };
  if (/^\d{1,11}$/.test(digits)) return { kind: "number", value: digits };
  return null;
}
