import type { OrderLine, OrderReview, OrderShipping } from "@/lib/shopify/order-cache";

/**
 * « Achats » page: what to buy (sales pace, orders still to send, stock, supplier orders on
 * the way, lead time) and the Shopify orders not shipped yet, shop by shop.
 */

export type EccangState = "none" | "pending" | "shipped";

export type PendingOrder = {
  clientId: string;
  clientName: string;
  shopId: string;
  shopDomain: string;
  market: string | null;
  orderId: string;
  /** Shopify order name (« #1042 ») when recorded. */
  name: string | null;
  /** Order date (YYYY-MM-DD). */
  date: string;
  ageDays: number;
  lines: OrderLine[];
  /** Units over the lines that carry a SKU. */
  units: number;
  /** Units of lines without SKU (cannot be matched to a product). */
  unitsWithoutSku: number;
  /** Shopify says some items already left. */
  partial: boolean;
  /** Flagged by the order checks (0 €, promo abuse…): to look at before sending. */
  flagged: boolean;
  eccang: EccangState;
  eccangTracking: string | null;
};

export type AgeBucket = "d0_2" | "d3_7" | "d8_30" | "d31";
export const AGE_BUCKETS: AgeBucket[] = ["d0_2", "d3_7", "d8_30", "d31"];

export function ageBucket(ageDays: number): AgeBucket {
  if (ageDays <= 2) return "d0_2";
  if (ageDays <= 7) return "d3_7";
  if (ageDays <= 30) return "d8_30";
  return "d31";
}

/** Whole days between an order date (YYYY-MM-DD) and `today` (UTC days). */
export function ageInDays(orderDate: string, today = new Date()) {
  const start = Date.parse(`${orderDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start)) return 0;
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

/** Still to send: not fulfilled in Shopify and not judged abusive. Partial orders stay listed. */
export function isPendingShipment(order: {
  fulfilled: boolean | null;
  shipping: OrderShipping | null;
  review: OrderReview | null;
}) {
  if (order.fulfilled === true) return false;
  if (order.shipping?.status === "fulfilled") return false;
  if (order.review === "abuse") return false;
  return true;
}

/** Order reference compared between Shopify and ECCANG: « #1042 », « 1042 » → « 1042 ». */
export function orderRefKey(value: unknown) {
  if (value == null) return null;
  const key = String(value).trim().replace(/^#+/, "").trim().toLowerCase();
  return key || null;
}

/** ECCANG order status → shipped (D), not usable (X / never accepted) or still in the warehouse. */
export function eccangStateOf(status: string | null | undefined, orderCode: string | null | undefined): EccangState {
  const code = (status ?? "").trim().toUpperCase().slice(0, 1);
  if (code === "D") return "shipped";
  if (code === "X" || !orderCode) return "none";
  return "pending";
}

export type ShopSummary = {
  shopId: string;
  clientId: string;
  clientName: string;
  shopDomain: string;
  market: string | null;
  orders: number;
  units: number;
  unitsWithoutSku: number;
  buckets: Record<AgeBucket, number>;
  inEccang: number;
  shippedByEccang: number;
  flagged: number;
  partial: number;
};

export function summarizeShops(orders: PendingOrder[]): ShopSummary[] {
  const byShop = new Map<string, ShopSummary>();
  for (const order of orders) {
    let row = byShop.get(order.shopId);
    if (!row) {
      row = {
        shopId: order.shopId,
        clientId: order.clientId,
        clientName: order.clientName,
        shopDomain: order.shopDomain,
        market: order.market,
        orders: 0,
        units: 0,
        unitsWithoutSku: 0,
        buckets: { d0_2: 0, d3_7: 0, d8_30: 0, d31: 0 },
        inEccang: 0,
        shippedByEccang: 0,
        flagged: 0,
        partial: 0,
      };
      byShop.set(order.shopId, row);
    }
    row.orders += 1;
    row.units += order.units;
    row.unitsWithoutSku += order.unitsWithoutSku;
    row.buckets[ageBucket(order.ageDays)] += 1;
    if (order.eccang === "pending") row.inEccang += 1;
    if (order.eccang === "shipped") row.shippedByEccang += 1;
    if (order.flagged) row.flagged += 1;
    if (order.partial) row.partial += 1;
  }
  return [...byShop.values()].sort((a, b) => b.orders - a.orders || a.clientName.localeCompare(b.clientName));
}

/** What the app knows about the product behind a SKU (per client). */
export type CatalogEntry = {
  productId: string;
  title: string;
  isUpsell: boolean;
  /** Warehouse stock (ECCANG) when known, else the declared stock; null = unknown. */
  stock: number | null;
  /** Already on the way: open supplier orders or ECCANG inbound (the larger of the two). */
  incoming: number;
  /** Days between ordering and having the goods in the warehouse. */
  leadDays: number | null;
  factoryPriceRmb: number | null;
  supplier: string | null;
  /** Pieces shipped per unit sold (sets). */
  packPieces: number;
};

export type BuyOptions = {
  /** Days of sales the stock must cover once the purchase arrives. */
  coverDays: number;
  /** Lead time used when the product has none. */
  defaultLeadDays: number;
  /** Days of sales used for the daily rate. */
  salesWindowDays: number;
};

export const DEFAULT_BUY_OPTIONS: BuyOptions = { coverDays: 14, defaultLeadDays: 7, salesWindowDays: 14 };

export type BuyLine = {
  clientId: string;
  clientName: string;
  sku: string;
  productId: string | null;
  title: string | null;
  isUpsell: boolean;
  /** Orders still to send that contain the SKU. */
  orders: number;
  /** Pieces needed by the orders still to send (units × pieces per set). */
  backlog: number;
  /** Pieces sold per day over the sales window. */
  perDay: number;
  stock: number | null;
  incoming: number;
  leadDays: number;
  /** Days the stock (+ incoming) lasts once the backlog is sent; null = no sales. */
  runwayDays: number | null;
  /** Backlog + sales during the lead time and the cover period. */
  need: number;
  toBuy: number;
  /** Runway shorter than the lead time (or backlog not covered): order now. */
  urgent: boolean;
  factoryPriceRmb: number | null;
  totalRmb: number | null;
  supplier: string | null;
};

type SkuKey = string;
const skuKey = (clientId: string, sku: string): SkuKey => `${clientId}|${sku.trim().toLowerCase()}`;

/**
 * Buying plan per SKU: pieces still owed to the orders not sent (orders already shipped by
 * ECCANG left out) + daily sales × (lead time + cover days) − stock − what is already coming.
 * `sold` = pieces sold per client|sku over `salesWindowDays` (every real order, sent or not).
 */
export function buildBuyList(
  pending: PendingOrder[],
  sold: Map<string, { clientId: string; clientName: string; sku: string; title: string | null; units: number }>,
  catalog: Map<string, Map<string, CatalogEntry>>,
  options: BuyOptions = DEFAULT_BUY_OPTIONS,
): BuyLine[] {
  const entryOf = (clientId: string, sku: string) => catalog.get(clientId)?.get(sku.trim().toLowerCase()) ?? null;
  const rows = new Map<SkuKey, { clientId: string; clientName: string; sku: string; title: string | null; backlog: number; orders: Set<string>; sold: number }>();
  const touch = (clientId: string, clientName: string, sku: string, title: string | null) => {
    const key = skuKey(clientId, sku);
    let row = rows.get(key);
    if (!row) {
      row = { clientId, clientName, sku: sku.trim(), title, backlog: 0, orders: new Set(), sold: 0 };
      rows.set(key, row);
    }
    if (!row.title && title) row.title = title;
    return row;
  };
  for (const order of pending) {
    if (order.eccang === "shipped") continue;
    for (const line of order.lines) {
      if (!line.sku.trim() || line.quantity <= 0) continue;
      const pieces = Math.max(1, entryOf(order.clientId, line.sku)?.packPieces ?? 1);
      const row = touch(order.clientId, order.clientName, line.sku, line.title ?? null);
      row.backlog += line.quantity * pieces;
      row.orders.add(`${order.shopId}:${order.orderId}`);
    }
  }
  for (const item of sold.values()) {
    const pieces = Math.max(1, entryOf(item.clientId, item.sku)?.packPieces ?? 1);
    touch(item.clientId, item.clientName, item.sku, item.title).sold += item.units * pieces;
  }
  const window = Math.max(1, options.salesWindowDays);
  return [...rows.values()]
    .map((row) => {
      const entry = entryOf(row.clientId, row.sku);
      const perDay = row.sold / window;
      const leadDays = Math.max(0, entry?.leadDays ?? options.defaultLeadDays);
      const stock = entry?.stock ?? null;
      const incoming = Math.max(0, entry?.incoming ?? 0);
      const available = Math.max(0, stock ?? 0) + incoming - row.backlog;
      const need = row.backlog + perDay * (leadDays + options.coverDays);
      const toBuy = Math.max(0, Math.ceil(need - Math.max(0, stock ?? 0) - incoming));
      const runwayDays = perDay > 0 ? Math.max(0, available) / perDay : null;
      const urgent = toBuy > 0 && (available < 0 || (runwayDays != null && runwayDays < leadDays));
      const factoryPriceRmb = entry?.factoryPriceRmb ?? null;
      return {
        clientId: row.clientId,
        clientName: row.clientName,
        sku: row.sku,
        productId: entry?.productId ?? null,
        title: entry?.title ?? row.title,
        isUpsell: entry?.isUpsell ?? false,
        orders: row.orders.size,
        backlog: row.backlog,
        perDay: Math.round(perDay * 10) / 10,
        stock,
        incoming,
        leadDays,
        runwayDays: runwayDays == null ? null : Math.floor(runwayDays),
        need: Math.ceil(need),
        toBuy,
        urgent,
        factoryPriceRmb,
        totalRmb: factoryPriceRmb != null ? Math.round(toBuy * factoryPriceRmb * 100) / 100 : null,
        supplier: entry?.supplier ?? null,
      } satisfies BuyLine;
    })
    .filter((line) => line.backlog > 0 || line.perDay > 0)
    .sort(
      (a, b) =>
        Number(b.urgent) - Number(a.urgent) ||
        b.toBuy - a.toBuy ||
        b.backlog - a.backlog ||
        a.clientName.localeCompare(b.clientName),
    );
}

// --- CSV (Excel FR: « ; » and a BOM so accents open correctly) --------------------------

export function toCsv(rows: Array<Array<string | number | null>>, separator = ";") {
  const cell = (value: string | number | null) => {
    if (value == null) return "";
    const text = typeof value === "number" ? String(value).replace(".", ",") : value;
    return /[";\n\r]/.test(text) || text.includes(separator) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `﻿${rows.map((row) => row.map(cell).join(separator)).join("\r\n")}\r\n`;
}

const ECCANG_LABEL: Record<EccangState, string> = { none: "", pending: "Dans ECCANG", shipped: "Expédiée par ECCANG" };

export function pendingOrdersCsv(orders: PendingOrder[]) {
  const rows: Array<Array<string | number | null>> = [
    ["Client", "Boutique", "Marché", "Commande", "Date", "Jours", "SKU", "Quantité", "Partielle", "À vérifier", "ECCANG", "Suivi ECCANG"],
  ];
  for (const order of orders) {
    const base = [order.clientName, order.shopDomain, order.market, order.name ?? order.orderId, order.date, order.ageDays];
    const tail = [order.partial ? "oui" : "", order.flagged ? "oui" : "", ECCANG_LABEL[order.eccang], order.eccangTracking];
    if (order.lines.length === 0) rows.push([...base, "", order.unitsWithoutSku || null, ...tail]);
    for (const line of order.lines) rows.push([...base, line.sku, line.quantity, ...tail]);
  }
  return toCsv(rows);
}

export function buyListCsv(lines: BuyLine[]) {
  const rows: Array<Array<string | number | null>> = [
    [
      "Client",
      "SKU",
      "Produit",
      "Upsell",
      "Urgent",
      "Commandes en attente",
      "Pièces en attente",
      "Ventes / jour",
      "Stock",
      "En route",
      "Délai (j)",
      "Jours de stock",
      "Besoin",
      "À acheter",
      "Prix usine (¥)",
      "Total (¥)",
      "Fournisseur",
    ],
  ];
  for (const line of lines) {
    rows.push([
      line.clientName,
      line.sku,
      line.title,
      line.isUpsell ? "oui" : "",
      line.urgent ? "oui" : "",
      line.orders,
      line.backlog,
      line.perDay,
      line.stock,
      line.incoming,
      line.leadDays,
      line.runwayDays,
      line.need,
      line.toBuy,
      line.factoryPriceRmb,
      line.totalRmb,
      line.supplier,
    ]);
  }
  return toCsv(rows);
}
