import { createHash } from "crypto";

export type OrderLine = { sku: string; quantity: number; title?: string };

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
  lines: Array<{ sku: string | null; quantity: number; title?: string | null; name?: string | null }>,
): OrderLine[] {
  return lines
    .filter((line) => line.sku?.trim())
    .map((line) => {
      const title = (line.title ?? line.name ?? "").trim();
      return title
        ? { sku: line.sku!.trim(), quantity: line.quantity, title: title.slice(0, 200) }
        : { sku: line.sku!.trim(), quantity: line.quantity };
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

export function packOrderLines(lines: OrderLine[], fulfilled: boolean) {
  return [{ _order: { fulfilled } }, ...lines];
}

export function unpackOrderLines(value: unknown): {
  fulfilled: boolean | null;
  lines: OrderLine[];
} {
  if (!Array.isArray(value)) return { fulfilled: null, lines: [] };
  let fulfilled: boolean | null = null;
  const lines: OrderLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      sku?: unknown;
      quantity?: unknown;
      title?: unknown;
      _order?: { fulfilled?: unknown };
    };
    if (row._order && typeof row._order === "object") {
      fulfilled = row._order.fulfilled === true;
      continue;
    }
    if (typeof row.sku !== "string" || !row.sku.trim()) continue;
    const line: OrderLine = { sku: row.sku.trim(), quantity: Number(row.quantity) || 0 };
    if (typeof row.title === "string" && row.title.trim()) line.title = row.title.trim();
    lines.push(line);
  }
  return { fulfilled, lines };
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
