/**
 * Upsells of a product (pouch, protective case, gift… sold with it in the same order), stored
 * on the main product's quote_json:
 * - `upsell_auto`: [{id, orders}] detected from the Shopify orders (bought together at least
 *   once; the cheaper item of the pair is the upsell), refreshed by the Shopify sync;
 * - `upsell_ids`: linked by hand by Voltship;
 * - `upsell_excluded_ids`: removed by Voltship, never re-added automatically.
 * Voltship keeps them in stock and the client composes a parcel main + upsells → COGS.
 */

type QuoteJson = Record<string, unknown> | null | undefined;

export const UPSELLS_MAX = 20;

export type AutoUpsell = { id: string; orders: number };

function idList(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === "string" && id.trim() !== ""))];
}

/** Upsells linked by hand. */
export function parseManualUpsellIds(quoteJson: QuoteJson): string[] {
  return idList(quoteJson?.upsell_ids);
}

export function parseExcludedUpsellIds(quoteJson: QuoteJson): string[] {
  return idList(quoteJson?.upsell_excluded_ids);
}

/** Upsells detected from the orders, most bought first. */
export function parseAutoUpsells(quoteJson: QuoteJson): AutoUpsell[] {
  const raw = quoteJson?.upsell_auto;
  if (!Array.isArray(raw)) return [];
  const out: AutoUpsell[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { id, orders } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id.trim() === "" || out.some((item) => item.id === id)) continue;
    out.push({ id, orders: Math.max(0, Math.round(Number(orders) || 0)) });
  }
  return out.sort((a, b) => b.orders - a.orders);
}

/** Every upsell of the product: by hand first, then detected, minus the removed ones. */
export function parseUpsellIds(quoteJson: QuoteJson): string[] {
  const excluded = new Set(parseExcludedUpsellIds(quoteJson));
  const ids = [...parseManualUpsellIds(quoteJson), ...parseAutoUpsells(quoteJson).map((item) => item.id)];
  return [...new Set(ids)].filter((id) => !excluded.has(id)).slice(0, UPSELLS_MAX);
}

/** Link (by hand) or remove an upsell; a removed upsell is never re-added automatically. */
export function withUpsell(quoteJson: QuoteJson, upsellId: string, add: boolean) {
  const manual = parseManualUpsellIds(quoteJson);
  const excluded = parseExcludedUpsellIds(quoteJson);
  return {
    ...(quoteJson ?? {}),
    upsell_ids: add ? [...new Set([...manual, upsellId])].slice(0, UPSELLS_MAX) : manual.filter((id) => id !== upsellId),
    upsell_excluded_ids: add ? excluded.filter((id) => id !== upsellId) : [...new Set([...excluded, upsellId])],
  };
}

/**
 * Pairs bought together, per order: main product id → upsell id → orders. In each order the
 * cheaper product (unit price paid, else the client price) is the upsell of the dearer one;
 * equal prices give no link.
 */
export function upsellPairs(
  orders: Array<Array<{ productId: string; price: number | null }>>,
  clientPrice: (productId: string) => number | null,
) {
  const pairs = new Map<string, Map<string, number>>();
  for (const lines of orders) {
    const prices = new Map<string, number | null>();
    for (const line of lines) {
      const price = line.price != null && Number.isFinite(line.price) ? line.price : null;
      const current = prices.get(line.productId);
      prices.set(line.productId, current == null ? price : price == null ? current : Math.max(current, price));
    }
    if (prices.size < 2) continue;
    const ids = [...prices.keys()];
    for (const main of ids) {
      for (const other of ids) {
        if (main === other) continue;
        const paidMain = prices.get(main) ?? null;
        const paidOther = prices.get(other) ?? null;
        let isUpsell = paidMain != null && paidOther != null && paidOther < paidMain;
        if (paidMain == null || paidOther == null || paidOther === paidMain) {
          const listMain = clientPrice(main);
          const listOther = clientPrice(other);
          isUpsell = listMain != null && listOther != null && listOther < listMain;
        }
        if (!isUpsell) continue;
        const row = pairs.get(main) ?? new Map<string, number>();
        row.set(other, (row.get(other) ?? 0) + 1);
        pairs.set(main, row);
      }
    }
  }
  return pairs;
}

/**
 * New detected list of a product. `full` (90-day recount): counts are replaced by the fresh
 * ones; otherwise (recent orders only) new upsells are added and counts never go down.
 * Upsells no longer found are kept: an upsell stays in stock until Voltship removes it.
 */
export function mergeAutoUpsells(existing: AutoUpsell[], found: Map<string, number> | undefined, full: boolean): AutoUpsell[] {
  const byId = new Map(existing.map((item) => [item.id, item.orders]));
  for (const [id, orders] of found ?? []) {
    byId.set(id, full ? orders : Math.max(byId.get(id) ?? 0, orders));
  }
  return [...byId.entries()]
    .map(([id, orders]) => ({ id, orders }))
    .sort((a, b) => b.orders - a.orders || a.id.localeCompare(b.id))
    .slice(0, UPSELLS_MAX);
}

export function sameAutoUpsells(a: AutoUpsell[], b: AutoUpsell[]) {
  return a.length === b.length && a.every((item, index) => item.id === b[index].id && item.orders === b[index].orders);
}

export type CoPurchase = {
  sku: string;
  title: string | null;
  /** Orders containing the main product AND this SKU. */
  orders: number;
  units: number;
};

/**
 * SKUs bought in the same orders as the main product (its SKUs), most frequent first.
 * `mainOrders` = orders that contain the main product.
 */
export function coPurchases(
  orders: Array<Array<{ sku: string; quantity: number; title?: string }>>,
  mainSkus: Set<string>,
): { mainOrders: number; items: CoPurchase[] } {
  const norm = (sku: string) => sku.trim().toLowerCase();
  const main = new Set([...mainSkus].map(norm));
  const bySku = new Map<string, CoPurchase>();
  let mainOrders = 0;
  for (const lines of orders) {
    if (!lines.some((line) => main.has(norm(line.sku)))) continue;
    mainOrders += 1;
    const seen = new Set<string>();
    for (const line of lines) {
      const key = norm(line.sku);
      if (main.has(key)) continue;
      const entry = bySku.get(key) ?? { sku: line.sku, title: line.title ?? null, orders: 0, units: 0 };
      if (!seen.has(key)) entry.orders += 1;
      entry.units += Math.max(0, line.quantity);
      if (!entry.title && line.title) entry.title = line.title;
      seen.add(key);
      bySku.set(key, entry);
    }
  }
  return { mainOrders, items: [...bySku.values()].sort((a, b) => b.orders - a.orders || b.units - a.units) };
}

/** A product line of the « Composer ma commande » block. */
export type ComposerItem = {
  id: string;
  title: string;
  sku: string | null;
  photoUrl: string | null;
  /** Client price per unit (€), null when not priced yet. */
  price: number | null;
  weightG: number | null;
  /** Stock (staff view only). */
  stock?: number | null;
};

export function composerItem(
  product: { id: string; title: string; sku: string | null; photo_url: string | null; client_price: number | null; weight_g: number | null },
  stock?: number | null,
): ComposerItem {
  return {
    id: product.id,
    title: product.title,
    sku: product.sku,
    photoUrl: product.photo_url,
    price: product.client_price != null ? Number(product.client_price) : null,
    weightG: product.weight_g != null ? Number(product.weight_g) : null,
    ...(stock !== undefined ? { stock } : {}),
  };
}
