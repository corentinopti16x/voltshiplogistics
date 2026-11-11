/**
 * Several carrier lines at once, pasted from a spreadsheet (tabs, semicolons or commas).
 * One row per weight tier; the rows of one line (same country, type, carrier and line name)
 * are grouped. Pure: parsed in the browser to show what will be imported before anything
 * is written.
 *
 * Columns, in this order (a header row is skipped):
 *   country · type · carrier · line · up to (g) · ¥ per kilo · ¥ per parcel ·
 *   min billed (g) · status · ECCANG line · delivery (days) · note
 */
import type { LineStatus } from "../domain/line-settings";
import type { ShippingChannel } from "../domain/pricing";
import {
  normalizeLinePrice,
  type LinePrice,
  type LinePriceError,
} from "./line-price";

export const LINE_SHEET_COLUMNS = [
  "pays",
  "type",
  "transporteur",
  "ligne",
  "jusqu_a_g",
  "yuan_par_kilo",
  "yuan_par_colis",
  "minimum_facture_g",
  "etat",
  "ligne_eccang",
  "delai_jours",
  "commentaire",
] as const;

const CHANNEL_ALIASES: Record<string, ShippingChannel> = {
  standard: "standard",
  普货: "standard",
  electronics_battery: "electronics_battery",
  batterie: "electronics_battery",
  battery: "electronics_battery",
  带电: "electronics_battery",
  cosmetics: "cosmetics",
  cosmetique: "cosmetics",
  cosmétique: "cosmetics",
  化妆品: "cosmetics",
  magnetic: "magnetic",
  aimant: "magnetic",
  magnetique: "magnetic",
  magnétique: "magnetic",
  带磁: "magnetic",
  sensitive_other: "sensitive_other",
  sensible: "sensitive_other",
  sensitive: "sensitive_other",
  敏感: "sensitive_other",
};

export type LineSheetEntry = {
  destination: string;
  channel: ShippingChannel;
  carrier: string;
  lineName: string | null;
  price: LinePrice;
  /** Only what the sheet fills is changed; an empty cell leaves the line as it is. */
  status: LineStatus | null;
  eccangMethod: string | null;
  deliveryDays: string | null;
  note: string | null;
};

export type LineSheetProblem = {
  /** 1-based row of the pasted text. */
  row: number;
  code: "columns" | "country" | "type" | "carrier" | "status" | LinePriceError;
};

function splitRow(row: string) {
  const separator = row.includes("\t") ? "\t" : row.includes(";") ? ";" : ",";
  return row.split(separator).map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

function number(text: string) {
  const clean = text.replace(/\s/g, "").replace(",", ".");
  return clean === "" ? 0 : Number(clean);
}

function status(text: string): LineStatus | null | undefined {
  const value = text.toLowerCase();
  if (value === "") return null;
  if (/^(active?|ouverte?|open|已开通)$/.test(value)) return "active";
  if (/^(pending|à ouvrir|a ouvrir|to open|待开通)$/.test(value))
    return "pending";
  return undefined;
}

export function parseLineSheet(text: string): {
  entries: LineSheetEntry[];
  problems: LineSheetProblem[];
} {
  const problems: LineSheetProblem[] = [];
  type Draft = Omit<LineSheetEntry, "price"> & {
    row: number;
    tiers: Array<{ maxG: number; perKgRmb: number; feeRmb: number }>;
    minBillableG: number;
  };
  const drafts = new Map<string, Draft>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const row = index + 1;
    if (!raw.trim()) return;
    const cells = splitRow(raw);
    // Header row: the first cell is not a country code.
    if (index === 0 && !/^[A-Za-z]{2}$/.test(cells[0] ?? "")) return;
    if (cells.length < 7) return problems.push({ row, code: "columns" });
    const [country, type, carrier, line, upTo, perKg, fee] = cells;
    const [minBillable = "", state = "", eccang = "", delivery = "", note = ""] =
      cells.slice(7);
    if (!/^[A-Za-z]{2}$/.test(country))
      return problems.push({ row, code: "country" });
    const channel = CHANNEL_ALIASES[type.toLowerCase()];
    if (!channel) return problems.push({ row, code: "type" });
    if (!carrier) return problems.push({ row, code: "carrier" });
    const parsedStatus = status(state);
    if (parsedStatus === undefined)
      return problems.push({ row, code: "status" });
    const destination = country.toUpperCase();
    const key = [destination, channel, carrier, line].join("|");
    const draft = drafts.get(key) ?? {
      row,
      destination,
      channel,
      carrier,
      lineName: line || null,
      status: null,
      eccangMethod: null,
      deliveryDays: null,
      note: null,
      tiers: [],
      minBillableG: 0,
    };
    draft.tiers.push({
      maxG: number(upTo),
      perKgRmb: number(perKg),
      feeRmb: number(fee),
    });
    draft.minBillableG ||= number(minBillable);
    draft.status ??= parsedStatus;
    draft.eccangMethod ??= eccang || null;
    draft.deliveryDays ??= delivery || null;
    draft.note ??= note || null;
    drafts.set(key, draft);
  });
  const entries: LineSheetEntry[] = [];
  for (const { row, tiers, minBillableG, ...line } of drafts.values()) {
    const price = normalizeLinePrice({
      tiers: [...tiers].sort((a, b) => a.maxG - b.maxG),
      minBillableG,
    });
    if (price.ok) entries.push({ ...line, price: price.price });
    else problems.push({ row, code: price.error });
  }
  return { entries, problems: problems.sort((a, b) => a.row - b.row) };
}
