import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { isSpreadsheetFile, sheetsFromWorkbook, sheetsToText, spreadsheetToText } from "./spreadsheet-text";

function workbookBuffer() {
  const wb = XLSX.utils.book_new();
  const fr = XLSX.utils.aoa_to_sheet([
    ["重量(g)", "云途 CHC", "4PX O5", null],
    [50, 21.5, 22.123456, null],
    [100, 24, 25, null],
    [null, null, null, null],
    [150, 27, 28.5],
  ]);
  XLSX.utils.book_append_sheet(wb, fr, "法国-普货");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[null]]), "empty");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("spreadsheet → text", () => {
  it("emits one block per non-empty sheet with header and numeric rows", () => {
    const text = spreadsheetToText(workbookBuffer());
    expect(text).toContain("### Sheet: 法国-普货");
    expect(text).toContain("重量(g) | 云途 CHC | 4PX O5");
    expect(text).toContain("50 | 21.5 | 22.1235");
    expect(text).toContain("150 | 27 | 28.5");
    expect(text).not.toContain("empty");
    expect(text.split("\n")).toHaveLength(5);
  });

  it("caps rows per sheet and flags truncation", () => {
    const wb = XLSX.read(workbookBuffer(), { type: "buffer" });
    const tables = sheetsFromWorkbook(wb, 2);
    expect(tables[0].rows).toHaveLength(2);
    expect(tables[0].truncated).toBe(true);
    expect(sheetsToText(tables)).toContain("truncated to 2 rows");
  });

  it("downsamples gram-by-gram tables to every 50 g instead of truncating", () => {
    const wb = XLSX.utils.book_new();
    const rows: unknown[][] = [["g", "TK"]];
    for (let g = 1; g <= 1000; g += 1) rows.push([g, 10 + g / 100]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "FRANCE-STANDARD");
    const tables = sheetsFromWorkbook(wb, 400);
    expect(tables[0].downsampled).toBe(true);
    expect(tables[0].truncated).toBe(false);
    expect(tables[0].rows).toHaveLength(21); // row 1 g + 50, 100 … 1000
    expect(tables[0].rows[1][0]).toBe("50");
    expect(tables[0].rows.at(-1)?.[0]).toBe("1000");
    expect(sheetsToText(tables)).toContain("sampled every 50 g");
  });

  it("detects spreadsheet files by extension or mime", () => {
    expect(isSpreadsheetFile("grille.xlsx", "application/octet-stream")).toBe(true);
    expect(isSpreadsheetFile("grille.bin", "application/vnd.ms-excel")).toBe(true);
    expect(isSpreadsheetFile("grille.csv", "text/csv")).toBe(false);
  });
});
