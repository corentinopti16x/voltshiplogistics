/**
 * Anti-doublon ECCANG — pure helpers, unit-tested.
 *
 * The same Shopify order can exist twice in ECCANG: once from a file import (no store bound,
 * so ECCANG cannot tell it is the same order and never marks it shipped in Shopify), once
 * pulled again by the Shopify sync. Shipping both is a loss. Rows are grouped by their
 * Shopify order id (eccang_orders.external_ref); in each group one order is kept and the
 * others are duplicates to cancel — or, when they already left, a double shipment to stop.
 */

export type DuplicateCandidate = {
  id: string;
  /** Shopify order id (numeric) the ECCANG order was created for. */
  external_ref: string | null;
  eccang_order_code: string | null;
  /** pending | C | W | D | H | N | P | X (see 00008_eccang.sql). */
  status: string | null;
  eccang_created_at: string | null;
  tracking_no: string | null;
};

export type DuplicateGroup = {
  shopifyOrderId: string;
  keep: DuplicateCandidate;
  /** Not shipped yet: to cancel in ECCANG before the warehouse picks them. */
  toCancel: DuplicateCandidate[];
  /** Shipped too (status D) while another copy was kept: already a double shipment. */
  shippedTwice: DuplicateCandidate[];
};

/** Higher = further in the flow (the copy the warehouse is working on is the one to keep). */
const STATUS_RANK: Record<string, number> = { D: 5, W: 4, C: 3, H: 2, N: 1, P: 1, pending: 0 };

function rank(row: DuplicateCandidate) {
  return STATUS_RANK[row.status ?? "pending"] ?? 0;
}

function createdTime(row: DuplicateCandidate) {
  const time = row.eccang_created_at ? Date.parse(row.eccang_created_at) : NaN;
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

export function isShopifyOrderId(value: string | null | undefined): value is string {
  return /^\d{6,}$/.test((value ?? "").trim());
}

/**
 * Groups the live (not cancelled) ECCANG orders by Shopify order id and returns the groups
 * holding more than one order. Kept: the most advanced copy (shipped > awaiting shipment >
 * awaiting review > held > abnormal), then the oldest one.
 */
export function findDuplicateGroups(rows: DuplicateCandidate[]): DuplicateGroup[] {
  const byOrder = new Map<string, DuplicateCandidate[]>();
  for (const row of rows) {
    if (!isShopifyOrderId(row.external_ref) || row.status === "X") continue;
    const key = row.external_ref.trim();
    const list = byOrder.get(key) ?? [];
    list.push(row);
    byOrder.set(key, list);
  }
  const groups: DuplicateGroup[] = [];
  for (const [shopifyOrderId, list] of byOrder) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => rank(b) - rank(a) || createdTime(a) - createdTime(b));
    const [keep, ...others] = sorted;
    groups.push({
      shopifyOrderId,
      keep,
      toCancel: others.filter((row) => row.status !== "D"),
      shippedTwice: others.filter((row) => row.status === "D"),
    });
  }
  return groups.sort((a, b) => a.shopifyOrderId.localeCompare(b.shopifyOrderId));
}

/** Carrier name for Shopify from an ECCANG tracking number / carrier code. */
export function shopifyCarrierFor(trackingNo: string, carrierCode: string | null) {
  if (/^YT\d/i.test(trackingNo.trim())) return "YunExpress";
  const code = (carrierCode ?? "").trim();
  return code && !/^other$/i.test(code) ? code : null;
}
