import * as XLSX from "xlsx";

/**
 * Carrier matrices arrive as .xlsx (one sheet per country × category, carriers as columns,
 * weight in grams as rows, RMB). The model gets each sheet as a compact text table:
 * sheet name, header row, then rows — numbers only, capped per sheet.
 */

export const SPREADSHEET_MAX_ROWS_PER_SHEET = 400;
const MAX_COLS = 40;

export type SheetTable = {
  name: string;
  header: string[];
  rows: string[][];
  truncated: boolean;
  /** Gram-by-gram table sampled at every 50 g so the model still sees the whole range. */
  downsampled: boolean;
};

export const DOWNSAMPLE_STEP_G = 50;

/**
 * When a sheet is longer than `maxRows` and its first column is a weight in grams, keep
 * only the rows at multiples of 50 g (plus the first row) instead of cutting the tail off.
 */
export function downsampleGramRows(rows: string[][], maxRows: number): { rows: string[][]; downsampled: boolean } {
  if (rows.length <= maxRows) return { rows, downsampled: false };
  const numeric = rows.filter((row) => row[0] !== undefined && /^\d+(\.\d+)?$/.test(row[0]));
  if (numeric.length < rows.length * 0.8) return { rows, downsampled: false };
  const sampled = rows.filter((row, index) => {
    const g = Number(row[0]);
    return index === 0 || (Number.isFinite(g) && g % DOWNSAMPLE_STEP_G === 0);
  });
  return { rows: sampled, downsampled: sampled.length < rows.length };
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Math.round(value * 10_000) / 10_000);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, " ").trim();
}

/** Rows as 2-D string arrays, empty trailing cells trimmed, blank rows dropped. */
export function sheetsFromWorkbook(workbook: XLSX.WorkBook, maxRows = SPREADSHEET_MAX_ROWS_PER_SHEET): SheetTable[] {
  const tables: SheetTable[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    const rows = matrix
      .map((row) => {
        const cells = (row ?? []).slice(0, MAX_COLS).map(cellText);
        while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
        return cells;
      })
      .filter((row) => row.some((cell) => cell !== ""));
    if (rows.length === 0) continue;
    const [header, ...body] = rows;
    const { rows: sampled, downsampled } = downsampleGramRows(body, maxRows);
    tables.push({
      name,
      header,
      rows: sampled.slice(0, maxRows),
      truncated: sampled.length > maxRows,
      downsampled,
    });
  }
  return tables;
}

export function sheetsToText(tables: SheetTable[]): string {
  return tables
    .map((table) => {
      const lines = [
        `### Sheet: ${table.name}`,
        table.header.join(" | "),
        ...table.rows.map((row) => row.join(" | ")),
      ];
      if (table.downsampled) lines.push(`(gram-by-gram table sampled every ${DOWNSAMPLE_STEP_G} g)`);
      if (table.truncated) lines.push(`… (truncated to ${table.rows.length} rows)`);
      return lines.join("\n");
    })
    .join("\n\n");
}

/** .xlsx / .xls / .csv buffer → text for the model. */
export function spreadsheetToText(buffer: Buffer | Uint8Array, maxRows = SPREADSHEET_MAX_ROWS_PER_SHEET): string {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const text = sheetsToText(sheetsFromWorkbook(workbook, maxRows));
  if (!text.trim()) throw new Error("The spreadsheet has no data.");
  return text;
}

export function isSpreadsheetFile(name: string, mime: string) {
  const lower = name.toLowerCase();
  return (
    /\.(xlsx|xlsm|xls)$/.test(lower) ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel"
  );
}
