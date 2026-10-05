import * as XLSX from "xlsx";
import type { ShippingChannel } from "../domain/pricing";
import { defaultWeightBrackets, normalizeCarrier, type ParsedLine, type ParsedPriceList } from "./ai-import";

/**
 * Deterministic importer for Voltship's own carrier matrix ("China_Carriers_Matrix_Vxx.xlsx").
 *
 * Layout: one sheet per DESTINATION-CATEGORY ("FRANCE-STANDARD", "USA-ELECTRONICS"…),
 * header row = carrier line names, column A = weight in grams (gram by gram), other
 * columns = carrier cost in RMB for a parcel of that weight, blank = not offered.
 * Some sheets carry a second header row with notes ("OBSOLÈTE") and a free-text notes
 * block below or beside the table. Formatting (cheapest highlighted) is ignored.
 *
 * No AI involved: the output is the same `ParsedPriceList` shape as the assistant path,
 * with one line per carrier column and `carrier = "matrix"` (multi-carrier import; every
 * line carries its own `carrier`).
 *
 * The matrix is "TOUT COMPRIS": every price is the FINAL carrier cost per parcel, so every
 * line is `tax_included = true`, `vat_extra = false` (`all_inclusive` on the list) and
 * nothing is excluded from the cheapest selection. The notes row is kept as text and only
 * drives the informational `ioss_required` flag and the "max N kg" limit.
 */

export const MATRIX_CARRIER = "matrix";

/** Sheet name pattern that identifies the Voltship matrix (auto-detection). */
export const MATRIX_SHEET_PATTERN = /^[A-Z]+-(STANDARD|ELECTRONICS|COSMETICS|FOOD|CLOTHING|TEXTILE|PERFUME|MAGNETIC)/i;

const DESTINATIONS: Record<string, string> = {
  FRANCE: "FR",
  FR: "FR",
  GERMANY: "DE",
  ALLEMAGNE: "DE",
  DE: "DE",
  BELGIUM: "BE",
  BELGIQUE: "BE",
  BE: "BE",
  ITALY: "IT",
  ITALIE: "IT",
  IT: "IT",
  USA: "US",
  US: "US",
  SPAIN: "ES",
  ESPAGNE: "ES",
  ES: "ES",
  PORTUGAL: "PT",
  PT: "PT",
  UK: "GB",
  GB: "GB",
  NETHERLANDS: "NL",
  NL: "NL",
};

const CATEGORIES: Record<string, { channel: ShippingChannel; note?: string }> = {
  STANDARD: { channel: "standard" },
  ELECTRONICS: { channel: "electronics_battery" },
  BATTERY: { channel: "electronics_battery" },
  COSMETICS: { channel: "cosmetics" },
  PERFUME: { channel: "liquid_perfume" },
  LIQUID: { channel: "liquid_perfume" },
  MAGNETIC: { channel: "magnetic" },
  FOOD: { channel: "sensitive_other" },
  SUPPLEMENTS: { channel: "sensitive_other" },
  SENSITIVE: { channel: "sensitive_other" },
  CLOTHING: { channel: "standard", note: "textile" },
  TEXTILE: { channel: "standard", note: "textile" },
};

export type SheetTarget = { destination: string; channel: ShippingChannel; note: string | null };

/** "FRANCE-STANDARD" → { FR, standard }; null when either half is unknown. */
export function mapSheetName(name: string): SheetTarget | null {
  const match = name.trim().match(/^([A-Za-zÀ-ÿ]+)\s*[-_ ]\s*([A-Za-zÀ-ÿ/]+)/);
  if (!match) return null;
  const destination = DESTINATIONS[match[1].toUpperCase()];
  // "CLOTHING/TEXTILE" style categories: any known token wins.
  const category = match[2]
    .toUpperCase()
    .split("/")
    .map((token) => CATEGORIES[token])
    .find((entry) => entry != null);
  if (!destination || !category) return null;
  return { destination, channel: category.channel, note: category.note ?? null };
}

export function isObsoleteHeader(text: string) {
  return /OBSOL[EÈ]TE|\bold\b/i.test(text);
}

export function detectCarrier(header: string): string {
  const key = header.toLowerCase();
  if (/tongyou|通邮|\btk\b|tk[普特]/i.test(header)) return "Tongyou";
  if (/yunexpress|yun\s?express|云途|\bchc\b/i.test(header)) return "YunExpress";
  if (/huahan|华翰|智/i.test(header)) return "Huahan";
  if (/4px|递四方|\bo5\b|\bjw\b/i.test(header)) return "4PX";
  return normalizeCarrier(key) ?? "other";
}

/**
 * The line ships under the client's IOSS number: notes/header say "IOSS obligatoire" or
 * "TVA via IOSS", or the line is YunExpress CHC / 4PX EU (S5667, S5664, S5682, 欧盟专线).
 * Informational only — never a cost.
 */
export function iossRequiredFor(carrier: string, headerText: string): boolean {
  if (/IOSS\s+obligatoire|TVA\s+via\s+IOSS/i.test(headerText)) return true;
  if (carrier === "YunExpress" && /\bCHC\b/i.test(headerText)) return true;
  if (carrier === "4PX" && /S566[47]|S5682|欧盟专线/i.test(headerText)) return true;
  return false;
}

/** "max 1 kg" / "max 2000 g" → grams; null when the notes state no weight limit. */
export function maxWeightFromNotes(notes: string): number | null {
  const match = notes.match(/max(?:imum|i)?\.?\s*(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(match[2].toLowerCase() === "kg" ? value * 1000 : value);
}

/** Prefix of the informational "price drops at a tier boundary" notices. */
export const TIER_CHANGE_NOTICE = "Changement de palier (normal)";

/** "9-14 d" → "9-14 j", "8-12 wd" / "6-10工作日" → "8-12 j ouvrés"; anything else kept raw. */
export function normalizeDelivery(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const match = text.match(/^(\d+)\s*[-–~]\s*(\d+)\s*(wd|工作日|working\s*days?|jours?\s*ouvr[ée]s?|d|days?|j|jours?)$/i);
  if (!match) return text;
  const unit = match[3].toLowerCase();
  const working = /^(wd|工作日|working|jours?\s*ouvr)/.test(unit);
  return `${match[1]}-${match[2]} ${working ? "j ouvrés" : "j"}`;
}

/** "TK普货 (direct 24/09)" / "智惠选-普货 [tout compris]" → "TK普货" / "智惠选-普货". */
export function cleanTier(raw: string) {
  return raw.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
}

/** Header block of a column: every row between the first header row and the first weight row. */
export type ColumnHeader = {
  /** Column text of the first header row (legacy single-row layout) or the "Carrier" row. */
  carrierText: string;
  tier: string | null;
  delivery: string | null;
  notes: string | null;
  /** All header texts joined (obsolete / keyword detection). */
  all: string;
};

function headerRole(label: string): "carrier" | "tier" | "delivery" | "notes" | "weight" | null {
  const key = label.toLowerCase();
  if (/^carrier|transporteur/.test(key)) return "carrier";
  if (/tier|service|ligne|line/.test(key)) return "tier";
  if (/delivery|délai|delai|transit/.test(key)) return "delivery";
  if (/size|limit|notes?|conditions?|taxes?/.test(key)) return "notes";
  if (/weight|poids|\(g\)/.test(key)) return "weight";
  return null;
}

export function readColumnHeader(headerRows: unknown[][], column: number): ColumnHeader {
  const texts = headerRows.map((row) => cellString((row ?? [])[column]));
  const header: ColumnHeader = {
    carrierText: texts[0] ?? "",
    tier: null,
    delivery: null,
    notes: null,
    all: texts.filter(Boolean).join(" "),
  };
  headerRows.forEach((row, index) => {
    const role = headerRole(cellString((row ?? [])[0]));
    const text = texts[index];
    if (!text) return;
    if (role === "carrier") header.carrierText = text;
    else if (role === "tier" && !header.tier) header.tier = text;
    else if (role === "delivery" && !header.delivery) header.delivery = text;
    else if (role === "notes") header.notes = header.notes ? `${header.notes} · ${text}` : text;
  });
  // Legacy layout without row labels: row 2 is the tier when it is not a note.
  if (headerRows.length > 1 && !header.tier && headerRole(cellString((headerRows[1] ?? [])[0])) == null) {
    const second = texts[1];
    if (second && !isObsoleteHeader(second) && !/TVA|tax|IOSS|droits/i.test(second)) header.tier = second;
  }
  return header;
}

/** Strip "★ NEW", emojis and extra whitespace from a header. */
export function cleanLineName(header: string) {
  return header
    .replace(/★|☆|\bNEW\b|\bNOUVEAU\b/gi, " ")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type RawBracket = { min_g: number; max_g: number; price: number };
export type GramPoint = { g: number; price: number | null };

/**
 * Gram-by-gram points → brackets: consecutive weights with the same price are merged
 * into [min, max]; a blank (not offered) ends the current bracket, and the next bracket
 * starts right after the last weight seen (blank or not), so gaps are never covered.
 */
export function compressBrackets(points: GramPoint[]): RawBracket[] {
  const out: RawBracket[] = [];
  let previousG = -1;
  let current: RawBracket | null = null;
  for (const point of points) {
    if (point.price == null) {
      current = null;
    } else if (current && current.price === point.price && current.max_g === previousG) {
      current.max_g = point.g;
    } else {
      current = { min_g: previousG + 1, max_g: point.g, price: point.price };
      out.push(current);
    }
    previousG = point.g;
  }
  return out;
}

/**
 * Engine brackets (50 g steps to 2 000 g, then 500 g steps) up to the table's max weight,
 * each priced at its MAX gram so a parcel anywhere in the bracket is never under-billed.
 * When the table has no row at that exact gram, the first heavier row is used; brackets
 * whose max is not offered (blank) are dropped.
 */
export function normalizeToEngineBrackets(points: GramPoint[]): RawBracket[] {
  const offered = points.filter((p): p is { g: number; price: number } => p.price != null);
  if (offered.length === 0) return [];
  const maxG = Math.max(...points.map((p) => p.g));
  const sorted = [...offered].sort((a, b) => a.g - b.g);
  const priceAtOrAbove = (g: number) => {
    const exact = points.find((p) => p.g === g);
    if (exact) return exact.price;
    return sorted.find((p) => p.g >= g)?.price ?? null;
  };
  const out: RawBracket[] = [];
  for (const bracket of defaultWeightBrackets(maxG)) {
    const price = priceAtOrAbove(bracket.max_g);
    if (price == null) continue;
    out.push({ min_g: bracket.min_g, max_g: bracket.max_g, price });
  }
  return out;
}

export type MatrixColumn = {
  sheet: string;
  column: number;
  header: string;
  lineIndex: number;
  rawBrackets: RawBracket[];
};

export type VoltshipMatrixResult = {
  parsed: ParsedPriceList;
  lines: ParsedLine[];
  warnings: string[];
  /** Per imported column: the gram-level brackets before 50 g normalisation. */
  columns: MatrixColumn[];
  sheets: { name: string; target: SheetTarget | null; columns: number }[];
};

function cellString(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function cellNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.,-]/g, "").replace(",", ".");
    if (!cleaned || !/\d/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isTextCell(value: unknown) {
  return typeof value === "string" && value.trim() !== "" && cellNumber(value) == null;
}

/** True when at least one sheet name follows the DESTINATION-CATEGORY convention. */
export function isVoltshipMatrix(sheetNames: string[]) {
  return sheetNames.some((name) => MATRIX_SHEET_PATTERN.test(name.trim()));
}

export function workbookSheetNames(buffer: Buffer | Uint8Array): string[] {
  return XLSX.read(buffer, { type: "buffer", bookSheets: true }).SheetNames ?? [];
}

export function parseVoltshipMatrix(buffer: Buffer | Uint8Array): VoltshipMatrixResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const lines: ParsedLine[] = [];
  const warnings: string[] = [];
  const columns: MatrixColumn[] = [];
  const sheets: VoltshipMatrixResult["sheets"] = [];

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const target = mapSheetName(name);
    if (!target) {
      warnings.push(`Sheet "${name}" skipped: name is not DESTINATION-CATEGORY.`);
      sheets.push({ name, target: null, columns: 0 });
      continue;
    }
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

    // Header = first row with ≥ 2 text cells; data = first row after it with a numeric column A.
    const headerIndex = matrix.findIndex((row) => (row ?? []).filter(isTextCell).length >= 2);
    if (headerIndex < 0) {
      warnings.push(`Sheet "${name}" skipped: no header row.`);
      sheets.push({ name, target, columns: 0 });
      continue;
    }
    let dataIndex = -1;
    for (let r = headerIndex + 1; r < matrix.length; r += 1) {
      if (cellNumber((matrix[r] ?? [])[0]) != null) {
        dataIndex = r;
        break;
      }
    }
    if (dataIndex < 0) {
      warnings.push(`Sheet "${name}" skipped: no weight rows.`);
      sheets.push({ name, target, columns: 0 });
      continue;
    }
    const headerRows = matrix.slice(headerIndex, dataIndex) as unknown[][];
    const width = Math.max(...matrix.slice(headerIndex).map((row) => (row ?? []).length));

    // Weight rows: contiguous numeric column A, stopping at a text cell (notes block below).
    const weightRows: { g: number; row: unknown[] }[] = [];
    for (let r = dataIndex; r < matrix.length; r += 1) {
      const row = matrix[r] ?? [];
      const g = cellNumber(row[0]);
      if (g == null) {
        if (isTextCell(row[0])) break;
        continue;
      }
      if (weightRows.length > 0 && g <= weightRows[weightRows.length - 1].g) {
        warnings.push(`Sheet "${name}": weight ${g} g out of order at row ${r + 1}; following rows ignored.`);
        break;
      }
      weightRows.push({ g: Math.round(g), row });
    }

    let sheetColumns = 0;
    for (let c = 1; c < width; c += 1) {
      const header = readColumnHeader(headerRows, c);
      if (!header.carrierText && !header.tier) continue;
      if (isObsoleteHeader(header.all)) continue;
      const label = [header.carrierText, header.tier].filter(Boolean).join(" ");

      const maxWeight = header.notes ? maxWeightFromNotes(header.notes) : null;
      let cutAboveLimit = false;
      const points: GramPoint[] = weightRows.map(({ g, row }) => {
        const price = cellNumber(row[c]);
        if (maxWeight != null && g > maxWeight && price != null) cutAboveLimit = true;
        const offered = price != null && price > 0 && (maxWeight == null || g <= maxWeight);
        return { g, price: offered ? price : null };
      });
      if (cutAboveLimit) {
        warnings.push(`Sheet "${name}", column "${label}": prices above the stated limit (${maxWeight} g) ignored.`);
      }
      if (!points.some((p) => p.price != null)) {
        warnings.push(`Sheet "${name}", column "${label}": no numeric price, skipped.`);
        continue;
      }
      let previous: number | null = null;
      for (const point of points) {
        if (point.price == null) continue;
        if (previous != null && point.price < previous) {
          warnings.push(`${TIER_CHANGE_NOTICE} — sheet "${name}", column "${label}": price drops at ${point.g} g.`);
          break;
        }
        previous = point.price;
      }

      const rawBrackets = compressBrackets(points);
      const rows = normalizeToEngineBrackets(points);
      if (rows.length === 0) {
        warnings.push(`Sheet "${name}", column "${label}": no bracket could be priced, skipped.`);
        continue;
      }
      const carrier = detectCarrier(header.all);
      const carrierLabel = carrier === "other" ? cleanLineName(header.carrierText) : carrier;
      const tier = header.tier ? cleanTier(cleanLineName(header.tier)) : "";
      const lineName = tier ? `${carrierLabel} ${tier}`.trim() : cleanLineName(header.carrierText) || label;
      const iossRequired = iossRequiredFor(carrier, header.all);
      const notes = [target.note, iossRequired ? "IOSS requis" : null, header.notes, `Matrix sheet ${name}`]
        .filter(Boolean)
        .join(" · ");
      const lineIndex = lines.length;
      lines.push({
        line_name: lineName,
        carrier,
        destination: target.destination,
        channel: target.channel,
        // "TOUT COMPRIS": the grid price is the final cost, nothing is ever added.
        tax_included: true,
        vat_extra: false,
        ioss_required: iossRequired,
        pricing: { type: "table", rows },
        delivery_range: header.delivery ? normalizeDelivery(header.delivery) : null,
        notes,
        min_billable_g: null,
        volumetric_divisor: null,
        confidence: 1,
      });
      columns.push({ sheet: name, column: c, header: label, lineIndex, rawBrackets });
      sheetColumns += 1;
    }
    sheets.push({ name, target, columns: sheetColumns });
  }

  const parsed: ParsedPriceList = {
    carrier: MATRIX_CARRIER,
    grid_date: null,
    currency: "RMB",
    all_inclusive: true,
    lines,
    warnings,
  };
  return { parsed, lines, warnings, columns, sheets };
}
