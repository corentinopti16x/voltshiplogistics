/** Supplier orders Voltship places for a client (production / restock). Pure helpers. */

export const PURCHASE_ORDER_STEPS = ["to_pay", "in_production", "quality_check", "to_warehouse", "received"] as const;
export type PurchaseOrderStep = (typeof PURCHASE_ORDER_STEPS)[number];
export type PurchaseOrderStatus = PurchaseOrderStep | "cancelled";
export const PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = [...PURCHASE_ORDER_STEPS, "cancelled"];

export function isPurchaseOrderStatus(value: unknown): value is PurchaseOrderStatus {
  return typeof value === "string" && (PURCHASE_ORDER_STATUSES as string[]).includes(value);
}

/** Open = the client is still waiting for it (not received, not cancelled). */
export function isOpenPurchaseOrder(status: string) {
  return status !== "received" && status !== "cancelled";
}

/** 0-based index of the current step (cancelled → -1), for the progress bar. */
export function stepIndex(status: string) {
  return status === "cancelled" ? -1 : PURCHASE_ORDER_STEPS.indexOf(status as PurchaseOrderStep);
}

/** "PO-<CODE>-<yymmdd>-<n>" — n = orders already created that day for the client + 1. */
export function purchaseOrderReference(clientCode: string | null | undefined, now: Date, sameDayCount: number) {
  const code = (clientCode ?? "CLIENT").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12) || "CLIENT";
  const day = now.toISOString().slice(2, 10).replaceAll("-", "");
  return `PO-${code}-${day}-${sameDayCount + 1}`;
}

export function purchaseOrderTotal(quantity: number, unitPrice: number | null, explicitTotal?: number | null) {
  if (explicitTotal != null && Number.isFinite(explicitTotal) && explicitTotal >= 0) {
    return Math.round(explicitTotal * 100) / 100;
  }
  if (unitPrice == null || !Number.isFinite(unitPrice)) return null;
  return Math.round(quantity * unitPrice * 100) / 100;
}

export type PurchaseOrderHistoryEntry = { status: PurchaseOrderStatus; at: string };

export function appendHistory(history: unknown, status: PurchaseOrderStatus, now = new Date()) {
  const list = Array.isArray(history) ? (history as PurchaseOrderHistoryEntry[]) : [];
  if (list.at(-1)?.status === status) return list;
  return [...list, { status, at: now.toISOString() }];
}
