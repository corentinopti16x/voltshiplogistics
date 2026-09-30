export type OrderLine = { sku: string; quantity: number };

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
      _order?: { fulfilled?: unknown };
    };
    if (row._order && typeof row._order === "object") {
      fulfilled = row._order.fulfilled === true;
      continue;
    }
    if (typeof row.sku !== "string" || !row.sku.trim()) continue;
    lines.push({ sku: row.sku.trim(), quantity: Number(row.quantity) || 0 });
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
