import { lineSku, type SkuResolver } from "./sku";
import { createHash } from "crypto";

export type OrderLine = { sku: string; quantity: number; title?: string; price?: number };

/** Shipping state of an order as Shopify reports it (fulfillment + tracking). */
export type OrderShipping = {
  /** fulfilled = every item shipped, partial = some, unfulfilled = none yet. */
  status: "fulfilled" | "partial" | "unfulfilled";
  trackingNumbers: string[];
  company: string | null;
  url: string | null;
  /** First fulfillment date (ISO), when shipped. */
  shippedAt: string | null;
};

/** Shopify fulfillment status (REST "fulfilled"/"partial"/null or GraphQL FULFILLED/PARTIALLY_FULFILLED…). */
export function shippingStatusOf(raw: string | null | undefined): OrderShipping["status"] | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "fulfilled") return "fulfilled";
  if (value === "partial" || value === "partially_fulfilled") return "partial";
  if (value === "unfulfilled" || value === "null" || value === "unshipped") return "unfulfilled";
  return null;
}

/** REST order `fulfillments` (webhook / orders.json) → tracking numbers, carrier, first ship date. */
export function shippingFromFulfillments(
  fulfillments:
    | Array<{
        created_at?: string | null;
        status?: string | null;
        tracking_company?: string | null;
        tracking_number?: string | null;
        tracking_numbers?: Array<string | null> | null;
        tracking_url?: string | null;
        tracking_urls?: Array<string | null> | null;
      }>
    | null
    | undefined,
  status: OrderShipping["status"] | null,
): OrderShipping | null {
  const active = (fulfillments ?? []).filter((f) => !f.status || !/cancel|error|failure/i.test(f.status));
  const numbers = [
    ...new Set(
      active
        .flatMap((f) => [...(f.tracking_numbers ?? []), f.tracking_number ?? null])
        .filter((n): n is string => typeof n === "string" && n.trim() !== "")
        .map((n) => n.trim()),
    ),
  ].slice(0, 5);
  const company = active.map((f) => f.tracking_company).find((c) => c && c.trim())?.trim() ?? null;
  const url =
    active.flatMap((f) => [...(f.tracking_urls ?? []), f.tracking_url ?? null]).find((u) => u && /^https?:\/\//.test(u)) ??
    null;
  const dates = active.map((f) => f.created_at).filter((d): d is string => Boolean(d)).sort();
  const resolved = status ?? (active.length > 0 ? "fulfilled" : null);
  if (!resolved && numbers.length === 0) return null;
  return {
    status: resolved ?? "unfulfilled",
    trackingNumbers: numbers,
    company,
    url,
    shippedAt: dates[0] ?? null,
  };
}

/**
 * Anonymised customer identifier for recurrence stats (no read_customers scope needed):
 * SHA-256 of the Shopify customer id when present, else of the lowercased e-mail.
 * The raw e-mail is never stored. Null when the order carries neither.
 */
export function customerKeyForOrder(order: {
  customer?: { id?: number | string | null } | null;
  email?: string | null;
  contact_email?: string | null;
}) {
  const customerId = order.customer?.id;
  if (customerId != null && String(customerId).trim()) {
    return createHash("sha256").update(`customer:${String(customerId).trim()}`).digest("hex");
  }
  const email = (order.email ?? order.contact_email ?? "").trim().toLowerCase();
  if (email) {
    return createHash("sha256").update(`email:${email}`).digest("hex");
  }
  return null;
}

/** SHA-256("email:<lowercased e-mail>") — same scheme as the e-mail branch of customerKeyForOrder. */
export function hashCustomerEmail(email: string | null | undefined) {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return createHash("sha256").update(`email:${normalized}`).digest("hex");
}

/** Shopify order_number (preferred) or name "#1234" → "1234"; null when neither is set. */
export function orderNumberOf(order: {
  order_number?: number | string | null;
  name?: string | null;
}) {
  if (order.order_number != null && String(order.order_number).trim()) {
    return String(order.order_number).trim();
  }
  const name = order.name?.trim().replace(/^#/, "");
  return name || null;
}

/** Cached line items: SKU + quantity, with the Shopify line title when available. */
export function cacheOrderLines(
  lines: Array<{
    sku: string | null;
    variant_id?: string | number | null;
    quantity: number;
    title?: string | null;
    name?: string | null;
    price?: string | number | null;
  }>,
  resolver?: SkuResolver | null,
): OrderLine[] {
  return lines
    .filter((line) => lineSku(line, resolver))
    .map((line) => {
      const title = (line.title ?? line.name ?? "").trim();
      const out: OrderLine = { sku: lineSku(line, resolver)!, quantity: line.quantity };
      if (title) out.title = title.slice(0, 200);
      const price = Number(line.price);
      if (line.price != null && Number.isFinite(price)) out.price = price;
      return out;
    });
}

/** Up to `max` image URLs in Shopify page order, the variant's own image first. */
export function pickProductImages(
  product: {
    image?: { src?: string } | null;
    images?: Array<{ id?: number; src?: string; position?: number }> | null;
  },
  variantImageId: number | null | undefined,
  max = 4,
) {
  const ordered = [...(product.images ?? [])]
    .filter((image) => typeof image.src === "string" && image.src.trim())
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const urls: string[] = [];
  const push = (src: string | undefined) => {
    if (src && !urls.includes(src) && urls.length < max) urls.push(src);
  };
  if (variantImageId != null) {
    push(ordered.find((image) => image.id === variantImageId)?.src);
  }
  for (const image of ordered) push(image.src);
  if (urls.length === 0) push(product.image?.src);
  return urls;
}

export function parseImagesJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/**
 * An order that cannot be a real sale: at least 10 units paid less than 1 € each in total
 * (e.g. a checkout bug abused: 50 coffrets for 2.99 €). Kept in the cache, flagged, and left
 * out of every sales figure (units, revenue, lifecycle, stock days).
 */
export function isSuspiciousOrder(total: unknown, units: number) {
  const amount = Number(total);
  if (total == null || !Number.isFinite(amount) || units < 10) return false;
  return amount / units < 1;
}

/** Decision taken on an order alert: "legit" puts the order back in the sales, "abuse" keeps it out. */
export type OrderReview = "legit" | "abuse";

/** Whether an order is left out of every sales figure, after any review on its alert. */
export function isExcludedOrder(total: unknown, units: number, review?: OrderReview | null) {
  if (review === "abuse") return true;
  if (review === "legit") return false;
  return isSuspiciousOrder(total, units);
}

export function packOrderLines(
  lines: OrderLine[],
  fulfilled: boolean,
  total?: {
    amount: unknown;
    currency?: string | null;
    units?: number;
    review?: OrderReview | null;
    /** Shopify order name ("#1042"), shown in the admin per-order margin. */
    name?: string | null;
    /** Fulfillment status + tracking (admin per-order margin). */
    shipping?: OrderShipping | null;
  } | null,
) {
  const amount = Number(total?.amount);
  const meta: Record<string, unknown> = { fulfilled };
  if (total?.amount != null && Number.isFinite(amount)) {
    meta.total = amount;
    meta.currency = total.currency ?? null;
  }
  if (total?.units != null && Number.isFinite(total.units)) meta.units = total.units;
  if (total?.review) meta.review = total.review;
  if (total?.name) meta.name = String(total.name).slice(0, 40);
  if (total?.shipping) {
    meta.ship = {
      s: total.shipping.status,
      t: total.shipping.trackingNumbers.slice(0, 5).map((n) => n.slice(0, 60)),
      c: total.shipping.company?.slice(0, 60) ?? null,
      u: total.shipping.url?.slice(0, 300) ?? null,
      at: total.shipping.shippedAt,
    };
  }
  if (total && isExcludedOrder(total.amount, total.units ?? 0, total.review)) meta.suspicious = true;
  return [{ _order: meta }, ...lines];
}

export function unpackOrderLines(value: unknown): {
  fulfilled: boolean | null;
  lines: OrderLine[];
  /** Order total paid by the customer (Shopify total_price), null for orders cached before it was stored. */
  total: number | null;
  currency: string | null;
  /** Units over every line of the order (with or without SKU), when recorded. */
  units: number | null;
  /** Flagged as not a real sale (see isSuspiciousOrder): excluded from sales figures. */
  suspicious: boolean;
  /** Decision taken on the order alert, if any. */
  review: OrderReview | null;
  /** Shopify order name ("#1042") when recorded. */
  name: string | null;
  /** Fulfillment status + tracking, when recorded. */
  shipping: OrderShipping | null;
} {
  if (!Array.isArray(value)) {
    return {
      fulfilled: null,
      lines: [],
      total: null,
      currency: null,
      units: null,
      suspicious: false,
      review: null,
      name: null,
      shipping: null,
    };
  }
  let suspicious = false;
  let review: OrderReview | null = null;
  let units: number | null = null;
  let fulfilled: boolean | null = null;
  let total: number | null = null;
  let currency: string | null = null;
  let name: string | null = null;
  let shipping: OrderShipping | null = null;
  const lines: OrderLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      sku?: unknown;
      quantity?: unknown;
      title?: unknown;
      price?: unknown;
      _order?: {
        fulfilled?: unknown;
        total?: unknown;
        currency?: unknown;
        units?: unknown;
        suspicious?: unknown;
        review?: unknown;
        name?: unknown;
        ship?: { s?: unknown; t?: unknown; c?: unknown; u?: unknown; at?: unknown };
      };
    };
    if (row._order && typeof row._order === "object") {
      fulfilled = row._order.fulfilled === true;
      const amount = Number(row._order.total);
      if (row._order.total != null && Number.isFinite(amount)) total = amount;
      if (typeof row._order.currency === "string") currency = row._order.currency;
      if (typeof row._order.name === "string") name = row._order.name;
      const ship = row._order.ship;
      if (ship && typeof ship === "object") {
        const status = shippingStatusOf(typeof ship.s === "string" ? ship.s : null);
        shipping = {
          status: status ?? "unfulfilled",
          trackingNumbers: Array.isArray(ship.t) ? ship.t.filter((n): n is string => typeof n === "string") : [],
          company: typeof ship.c === "string" ? ship.c : null,
          url: typeof ship.u === "string" ? ship.u : null,
          shippedAt: typeof ship.at === "string" ? ship.at : null,
        };
      }
      if (row._order.suspicious === true) suspicious = true;
      if (row._order.review === "legit" || row._order.review === "abuse") review = row._order.review;
      if (row._order.units != null && Number.isFinite(Number(row._order.units))) {
        units = Number(row._order.units);
      }
      continue;
    }
    if (typeof row.sku !== "string" || !row.sku.trim()) continue;
    const line: OrderLine = { sku: row.sku.trim(), quantity: Number(row.quantity) || 0 };
    if (typeof row.title === "string" && row.title.trim()) line.title = row.title.trim();
    if (row.price != null && Number.isFinite(Number(row.price))) line.price = Number(row.price);
    lines.push(line);
  }
  return { fulfilled, lines, total, currency, units, suspicious, review, name, shipping };
}

export function isShopifyFulfilled(status: string | null | undefined) {
  return status?.trim().toLowerCase() === "fulfilled";
}

/** REST Admin API 2026-07 returns fulfillment_status null even for shipped orders. */
export function resolveShopifyFulfillment(
  status: string | null | undefined,
  previous: boolean | null,
) {
  if (typeof status === "string" && status.trim()) return isShopifyFulfilled(status);
  return previous === true;
}
