export type StockStatus = "ok" | "reorder" | "critical" | "out_of_stock";

export type SafetyStockResult = {
  status: StockStatus;
  daysLeft: number | null;
  reorderPoint: number;
  suggestedQty: number;
  netAvailable: number;
};

export function calculateSafetyStock(input: {
  qtyAvailable: number;
  qtyReserved?: number;
  inboundQty?: number;
  salesPerDay: number;
  productionLeadDays?: number | null;
  shippingDays?: number | null;
  bufferDays?: number;
  coverageTargetDays?: number;
  moq?: number | null;
}): SafetyStockResult {
  const available = Math.max(0, input.qtyAvailable);
  const reserved = Math.max(0, input.qtyReserved ?? 0);
  const inbound = Math.max(0, input.inboundQty ?? 0);
  const velocity = Math.max(0, input.salesPerDay);
  const netAvailable = Math.max(0, available - reserved);
  const leadDays =
    Math.max(0, input.productionLeadDays ?? 0) +
    Math.max(0, input.shippingDays ?? 10) +
    Math.max(0, input.bufferDays ?? 7);
  const targetDays = Math.max(leadDays, input.coverageTargetDays ?? 60);
  const reorderPoint = Math.ceil(velocity * leadDays);
  const targetQty = Math.ceil(velocity * targetDays);
  const suggestedQty = roundUpToMoq(
    Math.max(0, targetQty - netAvailable - inbound),
    input.moq,
  );
  const daysLeft = velocity > 0 ? netAvailable / velocity : null;

  let status: StockStatus = "ok";
  if (netAvailable === 0) status = "out_of_stock";
  else if (velocity > 0 && netAvailable + inbound <= velocity * Math.max(7, leadDays / 2)) {
    status = "critical";
  } else if (velocity > 0 && netAvailable + inbound <= reorderPoint) {
    status = "reorder";
  }

  return { status, daysLeft, reorderPoint, suggestedQty, netAvailable };
}

export function roundUpToMoq(qty: number, moq?: number | null) {
  const step = Math.floor(moq ?? 0);
  if (qty <= 0 || step <= 1) return Math.ceil(Math.max(0, qty));
  return Math.ceil(qty / step) * step;
}
