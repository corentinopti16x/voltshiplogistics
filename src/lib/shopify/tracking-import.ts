/**
 * Tracking import (CSV → Shopify fulfillments) — pure helpers, unit-tested.
 *
 * Reads the tracking files we already produce (Matrixify layout: Order Name, Shopify Order
 * ID, Tracking Number, Tracking Company, Notify Customer) and any similar export (ECCANG,
 * carrier, previous agent): columns are matched loosely in English, French and Chinese,
 * separated by commas, semicolons or tabs. Each order is kept once.
 */

export type TrackingRow = {
  /** Line in the file (1 = header). */
  line: number;
  /** Shopify order number without "#" ("14236"), when the file has an order name column. */
  orderName: string | null;
  /** Numeric Shopify order id ("8272336093523"). */
  shopifyOrderId: string | null;
  trackingNumber: string;
  company: string | null;
};

export type TrackingInvalid = { line: number; reason: "no_order" | "no_tracking" };

export type TrackingParseResult = {
  rows: TrackingRow[];
  invalid: TrackingInvalid[];
  /** Lines for an order already seen (same order: only the first line is sent). */
  duplicates: number;
  /** "order" and/or "tracking" when no matching column header was found. */
  missingColumns: Array<"order" | "tracking">;
};

/** Largest file accepted by the form (the 2026-10 backlog is < 1 000 lines). */
export const MAX_TRACKING_ROWS = 5000;
/** Orders sent to Shopify per server call (≈ 2 Shopify requests each). */
export const TRACKING_CHUNK_SIZE = 20;

const HEADERS = {
  orderName: [
    "order name",
    "name",
    "order",
    "order number",
    "order no",
    "commande",
    "numero de commande",
    "n de commande",
    "订单号",
    "订单名称",
    "shopify order name",
    "shopify order",
  ],
  shopifyOrderId: ["shopify order id", "order id", "shopify id", "id commande shopify", "shopify订单id", "id"],
  tracking: [
    "tracking number",
    "tracking",
    "tracking no",
    "tracking numbers",
    "numero de suivi",
    "suivi",
    "n de suivi",
    "运单号",
    "跟踪号",
    "物流单号",
    "追踪号",
  ],
  company: ["tracking company", "carrier", "transporteur", "company", "shipping company", "物流商", "承运商", "物流公司"],
} as const;

function normalizeHeader(value: string) {
  return value
    .replace(/^﻿/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[°º#_.:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectDelimiter(headerLine: string) {
  const counts = [",", ";", "\t"].map((sep) => ({ sep, n: headerLine.split(sep).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].sep : ",";
}

/** RFC 4180-style split: quotes, doubled quotes, separators and newlines inside quotes. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const sep = delimiter ?? detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === "") quoted = true;
    else if (char === sep) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function findColumn(headers: string[], aliases: readonly string[], taken: Set<number>) {
  for (const alias of aliases) {
    const index = headers.findIndex((header, i) => !taken.has(i) && header === alias);
    if (index >= 0) return index;
  }
  return -1;
}

/** "#14236" / "14236" / "ECDF#14236" → "14236" (Shopify order_number). */
export function normalizeOrderName(raw: string | null | undefined) {
  const runs = (raw ?? "").match(/\d+/g);
  if (!runs) return null;
  const longest = runs.reduce((best, run) => (run.length > best.length ? run : best), "");
  return longest.length > 0 && longest.length <= 12 ? longest.replace(/^0+(?=\d)/, "") : null;
}

/** Shopify order ids are long integers; Excel's "8.27234E+12" is rejected (not exact). */
export function normalizeShopifyOrderId(raw: string | null | undefined) {
  const value = (raw ?? "").trim().replace(/^gid:\/\/shopify\/Order\//, "");
  return /^\d{6,20}$/.test(value) ? value : null;
}

export function normalizeTracking(raw: string | null | undefined) {
  const value = (raw ?? "").replace(/\s+/g, "").trim();
  return value.length >= 6 && value.length <= 64 ? value : null;
}

/** Carrier names as Shopify knows them (it builds the tracking link itself for these). */
const KNOWN_COMPANIES: Array<[RegExp, string]> = [
  [/^(yunexpress|yun express|云途.*)$/i, "YunExpress"],
  [/^usps$/i, "USPS"],
  [/^ups$/i, "UPS"],
  [/^fedex$/i, "FedEx"],
  [/^dhl( express)?$/i, "DHL Express"],
  [/^4px$/i, "4PX"],
  [/^china post$/i, "China Post"],
  [/^canada post$/i, "Canada Post"],
  [/^royal mail$/i, "Royal Mail"],
  [/^evri$/i, "Evri"],
  [/^yodel$/i, "Yodel"],
  [/^(la poste|colissimo)$/i, "La Poste"],
  [/^chronopost$/i, "Chronopost"],
  [/^gls$/i, "GLS"],
  [/^dpd$/i, "DPD"],
];

export function normalizeCompany(raw: string | null | undefined) {
  const value = (raw ?? "").trim();
  if (!value || /^(other|autre|其他|n\/?a|-)$/i.test(value)) return null;
  for (const [pattern, name] of KNOWN_COMPANIES) if (pattern.test(value)) return name;
  return value.slice(0, 80);
}

/**
 * Tracking link sent to Shopify: none for carriers Shopify knows (it builds its own), a
 * 17TRACK link for the others (XYY, Tongyou, Wanb…) so the customer can still follow it.
 */
export function trackingUrlFor(company: string | null, trackingNumber: string) {
  if (company && KNOWN_COMPANIES.some(([, name]) => name === company)) return null;
  return `https://t.17track.net/en#nums=${encodeURIComponent(trackingNumber)}`;
}

export function parseTrackingFile(text: string): TrackingParseResult {
  const table = parseCsv(text).filter((cells) => cells.some((cell) => cell.trim() !== ""));
  if (table.length === 0) return { rows: [], invalid: [], duplicates: 0, missingColumns: ["order", "tracking"] };
  const headers = table[0].map(normalizeHeader);
  const taken = new Set<number>();
  const take = (aliases: readonly string[]) => {
    const index = findColumn(headers, aliases, taken);
    if (index >= 0) taken.add(index);
    return index;
  };
  // Most specific first: "shopify order id" before "order name" ("order" would match both).
  const idCol = take(HEADERS.shopifyOrderId.slice(0, 5));
  const trackingCol = take(HEADERS.tracking);
  const companyCol = take(HEADERS.company);
  const nameCol = take(HEADERS.orderName);
  const plainIdCol = idCol >= 0 ? -1 : take(["id"]);
  const orderIdCol = idCol >= 0 ? idCol : plainIdCol;

  const missingColumns: TrackingParseResult["missingColumns"] = [];
  if (nameCol < 0 && orderIdCol < 0) missingColumns.push("order");
  if (trackingCol < 0) missingColumns.push("tracking");
  if (missingColumns.length) return { rows: [], invalid: [], duplicates: 0, missingColumns };

  const rows: TrackingRow[] = [];
  const invalid: TrackingInvalid[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  table.slice(1).forEach((cells, index) => {
    const line = index + 2;
    const cell = (col: number) => (col >= 0 ? (cells[col] ?? "").trim() : "");
    const shopifyOrderId = normalizeShopifyOrderId(cell(orderIdCol));
    const orderName = normalizeOrderName(cell(nameCol));
    const trackingNumber = normalizeTracking(cell(trackingCol));
    if (!shopifyOrderId && !orderName) {
      invalid.push({ line, reason: "no_order" });
      return;
    }
    if (!trackingNumber) {
      invalid.push({ line, reason: "no_tracking" });
      return;
    }
    const key = shopifyOrderId ? `id:${shopifyOrderId}` : `name:${orderName}`;
    if (seen.has(key)) {
      duplicates += 1;
      return;
    }
    seen.add(key);
    if (shopifyOrderId && orderName) seen.add(`name:${orderName}`);
    rows.push({ line, orderName, shopifyOrderId, trackingNumber, company: normalizeCompany(cell(companyCol)) });
  });
  return { rows, invalid, duplicates, missingColumns };
}

export function chunkRows<T>(rows: T[], size = TRACKING_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

/** Validates rows coming back from the browser (server action input). */
export function sanitizeTrackingRows(input: unknown, max = TRACKING_CHUNK_SIZE): TrackingRow[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > max) return null;
  const rows: TrackingRow[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const value = raw as Record<string, unknown>;
    const trackingNumber = normalizeTracking(typeof value.trackingNumber === "string" ? value.trackingNumber : null);
    const shopifyOrderId = normalizeShopifyOrderId(typeof value.shopifyOrderId === "string" ? value.shopifyOrderId : null);
    const orderName = normalizeOrderName(typeof value.orderName === "string" ? value.orderName : null);
    if (!trackingNumber || (!shopifyOrderId && !orderName)) return null;
    rows.push({
      line: Number.isInteger(value.line) ? Number(value.line) : 0,
      orderName,
      shopifyOrderId,
      trackingNumber,
      company: normalizeCompany(typeof value.company === "string" ? value.company : null),
    });
  }
  return rows;
}
