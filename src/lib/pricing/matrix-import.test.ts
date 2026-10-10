import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { expandToCells, importedCarriers, mergeGridCells, summarizeImport, type GridCellRecord } from "./ai-import";
import {
  cleanLineName,
  cleanTier,
  iossRequiredFor,
  maxWeightFromNotes,
  normalizeDelivery,
  TIER_CHANGE_NOTICE,
  compressBrackets,
  detectCarrier,
  isObsoleteHeader,
  isVoltshipMatrix,
  mapSheetName,
  normalizeToEngineBrackets,
  parseVoltshipMatrix,
  workbookSheetNames,
} from "./matrix-import";
import { DEFAULT_PRICING_SETTINGS } from "./settings";

/**
 * In-memory "China_Carriers_Matrix" with three sheets:
 * - FRANCE-STANDARD: title + notes rows, 4 carrier columns (one OBSOLÈTE on row 2),
 *   weights 1…2600 g gram by gram, a blank range for 4PX and a notes block below.
 * - USA-ELECTRONICS: a column with a price that decreases with weight.
 * - BELGIUM-COSMETICS: notes block beside the table.
 * - CLIENTS: not a matrix sheet (skipped with a warning).
 */
function fixtureBuffer() {
  const wb = XLSX.utils.book_new();

  const fr: unknown[][] = [
    ["Matrice V12 — FRANCE STANDARD", null, null, null, null],
    [null],
    ["Poids (g)", "Tongyou TK普货 ★ NEW", "YunExpress CHC 普货", "Huahan 智惠选-普货", "4PX O5", "Old 云途 line"],
    [null, null, null, "TVA en sus", null, "OBSOLÈTE"],
  ];
  for (let g = 1; g <= 2600; g += 1) {
    // Tongyou: 20 up to 100 g, then +2 per 100 g started. YunExpress: flat 18 + 0.01/g.
    const tongyou = 20 + 2 * Math.floor((g - 1) / 100);
    const yun = Math.round((18 + 0.01 * g) * 100) / 100;
    const huahan = 15 + Math.floor(g / 500);
    // 4PX: not offered under 100 g nor above 2000 g.
    const fourpx = g < 100 || g > 2000 ? null : 22 + Math.floor(g / 250);
    fr.push([g, tongyou, yun, huahan, fourpx, 99]);
  }
  fr.push([null]);
  fr.push(["Compléments alimentaires OK sur TK特货"]);
  fr.push(["VERT = moins cher"]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fr), "FRANCE-STANDARD");

  const us: unknown[][] = [["g", "Tongyou TK带电", "4PX JW"]];
  for (let g = 1; g <= 200; g += 1) us.push([g, g <= 100 ? 40 : 38, 30 + Math.floor(g / 50)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(us), "USA-ELECTRONICS");

  const be: unknown[][] = [["Poids", "云途 化妆品专线", "Empty column", null, "Notes"]];
  for (let g = 1; g <= 120; g += 1) be.push([g, 25, null, null, g === 1 ? "VERT = moins cher" : null]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(be), "BELGIUM-COSMETICS");

  // V12 layout: 5-row header block with row labels in column A.
  const de: unknown[][] = [
    ["Carrier", "TONGYOU ★ NEW", "HUAHAN ★ NEW", "YUNEXPRESS ★ NEW", "4PX ★ NEW", "4PX"],
    ["Tier / Service", "TK普货 (direct 24/09)", "智惠选-普货 (direct 28/09)", "THPHR-CHC (CHC 29/09)", "S5667 欧盟专线4-普货 (dès 8/10)", "O5 (old)"],
    ["Delivery", "9-14 d", "8-12 wd", "6-10工作日", "10-12 wd", "10 d"],
    [
      "Size limits",
      "Droits+TVA UE INCLUS · pas de 3€",
      "Droits inclus · TVA NON incluse (IOSS fourni par Huahan = prix grille, confirmé 28/09) · max 100 g",
      "Sans TVA (confirmé 小夫 29/09) · max 1 kg · 1 colis/envoi · <150€ · 3€ à confirmer",
      "Sans 3€ · IOSS obligatoire · TVA via IOSS · sachet uniquement",
      "OBSOLÈTE",
    ],
    ["Weight (g)", "direct", "direct", "direct", "direct", "direct"],
  ];
  for (let g = 1; g <= 150; g += 1) de.push([g, 28.45, 28.49, g <= 100 ? 23 : null, 31.15, 1]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(de), "GERMANY-STANDARD");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["client", "x"], ["a", 1]]), "CLIENTS");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("matrix helpers", () => {
  it("maps sheet names to destination + channel", () => {
    expect(mapSheetName("FRANCE-STANDARD")).toEqual({ destination: "FR", channel: "standard", note: null });
    expect(mapSheetName("USA-ELECTRONICS")).toMatchObject({ destination: "US", channel: "electronics_battery" });
    expect(mapSheetName("BELGIUM-COSMETICS")).toMatchObject({ destination: "BE", channel: "cosmetics" });
    expect(mapSheetName("ITALY-FOOD")).toMatchObject({ destination: "IT", channel: "sensitive_other" });
    expect(mapSheetName("Allemagne - Perfume")).toMatchObject({ destination: "DE", channel: "liquid_perfume" });
    expect(mapSheetName("UK-CLOTHING/TEXTILE")).toEqual({ destination: "GB", channel: "standard", note: "textile" });
    expect(mapSheetName("NETHERLANDS-MAGNETIC")).toMatchObject({ destination: "NL", channel: "magnetic" });
    expect(mapSheetName("CLIENTS")).toBeNull();
    expect(mapSheetName("MARS-STANDARD")).toBeNull();
  });

  it("detects carriers from headers and the informational IOSS flag", () => {
    expect(detectCarrier("Tongyou TK普货 ★ NEW")).toBe("Tongyou");
    expect(detectCarrier("云途 CHC 普货")).toBe("YunExpress");
    expect(detectCarrier("Huahan 智惠选-普货")).toBe("Huahan");
    expect(detectCarrier("4PX O5")).toBe("4PX");
    expect(detectCarrier("JW line")).toBe("4PX");
    expect(detectCarrier("Mystery")).toBe("other");
    expect(iossRequiredFor("YunExpress", "YUNEXPRESS THPHR-CHC")).toBe(true);
    expect(iossRequiredFor("YunExpress", "YUNEXPRESS 特惠普货 THPHR")).toBe(false);
    expect(iossRequiredFor("4PX", "4PX S5667 欧盟专线4-普货")).toBe(true);
    expect(iossRequiredFor("4PX", "4PX O5 经济普货")).toBe(false);
    expect(iossRequiredFor("Tongyou", "Sans 3€ · IOSS obligatoire")).toBe(true);
    expect(iossRequiredFor("Huahan", "TVA via IOSS")).toBe(true);
    expect(iossRequiredFor("Tongyou", "Droits+TVA UE INCLUS")).toBe(false);
    expect(isObsoleteHeader("OBSOLÈTE")).toBe(true);
    expect(isObsoleteHeader("old line")).toBe(true);
    expect(isObsoleteHeader("Gold line")).toBe(false);
    expect(cleanLineName("Tongyou TK普货 ★ NEW 🚀  ")).toBe("Tongyou TK普货");
  });

  it("reads tiers, delivery and weight limits", () => {
    expect(maxWeightFromNotes("Sans TVA (confirmé) · max 1 kg · 3€ à confirmer")).toBe(1000);
    expect(maxWeightFromNotes("max 2000 g")).toBe(2000);
    expect(maxWeightFromNotes("max 1,5 kg")).toBe(1500);
    expect(maxWeightFromNotes("<150€ · sachet uniquement")).toBeNull();
    expect(cleanTier("TK普货 (direct 24/09)")).toBe("TK普货");
    expect(cleanTier("智惠选-普货 [tout compris] (direct 28/09)")).toBe("智惠选-普货");
    expect(normalizeDelivery("9-14 d")).toBe("9-14 j");
    expect(normalizeDelivery("8-12 wd")).toBe("8-12 j ouvrés");
    expect(normalizeDelivery("6-10工作日")).toBe("6-10 j ouvrés");
    expect(normalizeDelivery("about a week")).toBe("about a week");
  });

  it("compresses equal consecutive prices into brackets and respects blanks", () => {
    const points = [
      { g: 1, price: 10 },
      { g: 2, price: 10 },
      { g: 3, price: 12 },
      { g: 4, price: null },
      { g: 5, price: 12 },
      { g: 6, price: 12 },
    ];
    expect(compressBrackets(points)).toEqual([
      { min_g: 0, max_g: 2, price: 10 },
      { min_g: 3, max_g: 3, price: 12 },
      { min_g: 5, max_g: 6, price: 12 },
    ]);
  });

  it("normalises to 50 g engine brackets priced at the bracket's max gram", () => {
    const points = Array.from({ length: 2600 }, (_, i) => ({ g: i + 1, price: i + 1 <= 50 ? 10 : i + 1 <= 2500 ? 11 : 12 }));
    const rows = normalizeToEngineBrackets(points);
    expect(rows[0]).toEqual({ min_g: 0, max_g: 50, price: 10 });
    expect(rows[1]).toEqual({ min_g: 51, max_g: 100, price: 11 });
    expect(rows[39]).toEqual({ min_g: 1951, max_g: 2000, price: 11 });
    expect(rows[40]).toEqual({ min_g: 2001, max_g: 2500, price: 11 });
    expect(rows[41]).toEqual({ min_g: 2501, max_g: 2600, price: 12 });
    expect(rows).toHaveLength(42);
    // Price changes inside a bracket → the max gram wins (never under-bill).
    const mixed = Array.from({ length: 100 }, (_, i) => ({ g: i + 1, price: i + 1 < 50 ? 1 : 2 }));
    expect(normalizeToEngineBrackets(mixed)[0].price).toBe(2);
    // Table in 10 g steps: first heavier row is used when the exact gram is missing.
    const coarse = [{ g: 10, price: 1 }, { g: 40, price: 2 }, { g: 60, price: 3 }];
    expect(normalizeToEngineBrackets(coarse)).toEqual([{ min_g: 0, max_g: 50, price: 3 }]);
  });
});

describe("parseVoltshipMatrix", () => {
  const buffer = fixtureBuffer();
  const result = parseVoltshipMatrix(buffer);
  const { parsed } = result;

  it("is auto-detected from the sheet names", () => {
    expect(isVoltshipMatrix(workbookSheetNames(buffer))).toBe(true);
    expect(isVoltshipMatrix(["法国-普货", "Sheet1"])).toBe(false);
  });

  it("emits one line per carrier column with destination, channel, carrier and flags", () => {
    expect(parsed.carrier).toBe("matrix");
    expect(parsed.currency).toBe("RMB");
    const fr = parsed.lines.filter((l) => l.destination === "FR");
    // "TOUT COMPRIS": every line is final, nothing is excluded; IOSS is informational.
    expect(fr.map((l) => [l.line_name, l.carrier, l.tax_included, l.vat_extra, l.ioss_required])).toEqual([
      ["Tongyou TK普货", "Tongyou", true, false, false],
      ["YunExpress CHC 普货", "YunExpress", true, false, true],
      ["Huahan 智惠选-普货", "Huahan", true, false, false],
      ["4PX O5", "4PX", true, false, false],
    ]);
    expect(parsed.all_inclusive).toBe(true);
    expect(fr.every((l) => l.channel === "standard" && l.confidence === 1)).toBe(true);
    expect(parsed.lines.some((l) => l.line_name.includes("Old"))).toBe(false); // OBSOLÈTE skipped

    const us = parsed.lines.filter((l) => l.destination === "US");
    expect(us.map((l) => [l.carrier, l.channel, l.tax_included])).toEqual([
      ["Tongyou", "electronics_battery", true],
      ["4PX", "electronics_battery", true],
    ]);
    const be = parsed.lines.filter((l) => l.destination === "BE");
    expect(be).toHaveLength(1);
    expect(be[0]).toMatchObject({ carrier: "YunExpress", channel: "cosmetics", line_name: "云途 化妆品专线" });
    expect(importedCarriers(parsed)).toEqual(["4PX", "Huahan", "Tongyou", "YunExpress"]);
  });

  it("reads the 5-row V12 header block (carrier, tier, delivery, notes) per column", () => {
    const de = parsed.lines.filter((l) => l.destination === "DE");
    expect(de.map((l) => [l.carrier, l.line_name, l.delivery_range, l.tax_included, l.ioss_required])).toEqual([
      ["Tongyou", "Tongyou TK普货", "9-14 j", true, false],
      ["Huahan", "Huahan 智惠选-普货", "8-12 j ouvrés", true, false],
      ["YunExpress", "YunExpress THPHR-CHC", "6-10 j ouvrés", true, true],
      ["4PX", "4PX S5667 欧盟专线4-普货", "10-12 j ouvrés", true, true],
    ]); // the OBSOLÈTE "4PX O5 (old)" column is skipped
    expect(de[3].notes).toBe("IOSS requis · Sans 3€ · IOSS obligatoire · TVA via IOSS · sachet uniquement · Matrix sheet GERMANY-STANDARD");
    expect(de[2].notes).toContain("max 1 kg");
    if (de[2].pricing.type !== "table") throw new Error("table expected");
    // YunExpress column: prices up to 100 g only (blank above) and "max 1 kg" → two brackets.
    expect(de[2].pricing.rows).toEqual([
      { min_g: 0, max_g: 50, price: 23 },
      { min_g: 51, max_g: 100, price: 23 },
    ]);
    // Huahan column: prices up to 150 g but notes say "max 100 g" → cut at the limit, with a warning.
    expect(parsed.warnings).toContain('Sheet "GERMANY-STANDARD", column "HUAHAN ★ NEW 智惠选-普货 (direct 28/09)": prices above the stated limit (100 g) ignored.');
    if (de[1].pricing.type !== "table") throw new Error("table expected");
    expect(de[1].pricing.rows.at(-1)).toEqual({ min_g: 51, max_g: 100, price: 28.49 });
  });

  it("compresses gram rows into brackets and normalises to 50 g steps with the max-gram price", () => {
    const tongyou = result.columns.find((c) => c.sheet === "FRANCE-STANDARD" && c.header.startsWith("Tongyou"))!;
    expect(tongyou.rawBrackets[0]).toEqual({ min_g: 0, max_g: 100, price: 20 });
    expect(tongyou.rawBrackets[1]).toEqual({ min_g: 101, max_g: 200, price: 22 });
    expect(tongyou.rawBrackets).toHaveLength(26);

    const line = parsed.lines[tongyou.lineIndex];
    expect(line.pricing.type).toBe("table");
    if (line.pricing.type !== "table") throw new Error("table expected");
    const rows = line.pricing.rows;
    expect(rows[0]).toEqual({ min_g: 0, max_g: 50, price: 20 });
    expect(rows[1]).toEqual({ min_g: 51, max_g: 100, price: 20 });
    expect(rows[2]).toEqual({ min_g: 101, max_g: 150, price: 22 }); // price at 150 g, not at 101 g
    expect(rows[39]).toEqual({ min_g: 1951, max_g: 2000, price: 58 });
    expect(rows[40]).toEqual({ min_g: 2001, max_g: 2500, price: 68 });
    expect(rows[41]).toEqual({ min_g: 2501, max_g: 2600, price: 70 });
    expect(rows).toHaveLength(42);

    // YunExpress: price changes every gram → the max gram of each bracket.
    const yun = parsed.lines.find((l) => l.destination === "FR" && l.carrier === "YunExpress")!;
    if (yun.pricing.type !== "table") throw new Error("table expected");
    expect(yun.pricing.rows[0].price).toBe(18.5);
    expect(yun.pricing.rows[1].price).toBe(19);
  });

  it("drops brackets the carrier does not offer (blank cells)", () => {
    const fourpx = parsed.lines.find((l) => l.destination === "FR" && l.carrier === "4PX")!;
    if (fourpx.pricing.type !== "table") throw new Error("table expected");
    expect(fourpx.pricing.rows[0]).toEqual({ min_g: 51, max_g: 100, price: 22 }); // 0–50 not offered
    expect(fourpx.pricing.rows.at(-1)).toEqual({ min_g: 1951, max_g: 2000, price: 30 }); // nothing above 2 kg
    const column = result.columns.find((c) => c.header === "4PX O5")!;
    expect(column.rawBrackets[0]).toEqual({ min_g: 100, max_g: 249, price: 22 });
  });

  it("collects warnings for unmapped sheets, empty columns and decreasing prices", () => {
    expect(parsed.warnings).toContain('Sheet "CLIENTS" skipped: name is not DESTINATION-CATEGORY.');
    expect(parsed.warnings).toContain('Sheet "BELGIUM-COSMETICS", column "Empty column": no numeric price, skipped.');
    expect(
      parsed.warnings.some((w) => w.startsWith(TIER_CHANGE_NOTICE) && w.includes('"USA-ELECTRONICS", column "Tongyou TK带电"')),
    ).toBe(true);
    expect(parsed.warnings.some((w) => w.includes('"Notes"'))).toBe(true);
    expect(parsed.lines).toHaveLength(11);
  });

  it("feeds the margin rule as the assistant path does", () => {
    const cells = expandToCells(parsed, DEFAULT_PRICING_SETTINGS);
    const fr50 = cells.find((c) => c.carrier === "Tongyou" && c.destination === "FR" && c.weightMaxG === 50)!;
    expect(fr50.carrierCostRmb).toBe(20);
    const costEur = 20 / DEFAULT_PRICING_SETTINGS.fx_rmb_per_eur;
    const expected =
      Math.round(
        (costEur + Math.max(costEur * (DEFAULT_PRICING_SETTINGS.margin_pct / 100), DEFAULT_PRICING_SETTINGS.min_margin_eur_per_parcel)) * 20,
      ) / 20;
    expect(fr50.price).toBe(expected);
    // All-inclusive: every carrier competes, nothing is excluded by default.
    expect(cells.some((c) => c.carrier === "Huahan")).toBe(true);
    expect(cells.find((c) => c.carrier === "YunExpress" && c.destination === "FR")?.iossRequired).toBe(true);
    const summary = summarizeImport(parsed, cells);
    expect(summary.carriers).toEqual(["4PX", "Huahan", "Tongyou", "YunExpress"]);
    expect(summary.notTaxIncludedLines).toBe(0);
    expect(summary.perCarrier.Huahan).toEqual({ lines: 2, included: 2 });
    expect(summary.perCarrier.Tongyou).toEqual({ lines: 3, included: 3 });
  });
});

describe("multi-carrier merge", () => {
  const record = (carrier: string, destination: string, price: number): GridCellRecord => ({
    carrier,
    destination,
    channel: "standard",
    weightMinG: 0,
    weightMaxG: 50,
    price,
    deliveryRange: null,
    lineName: null,
    taxIncluded: true,
    notes: null,
    carrierCostRmb: null,
    iossRequired: false,
  });

  it("replaces every imported carrier and carries the rest forward", () => {
    const active = [
      record("Tongyou", "FR", 9),
      record("YunExpress", "FR", 8),
      record("YunExpress", "DE", 8.5), // DE not in the import but YunExpress is → replaced (dropped)
      record("Huahan", "FR", 7),
      record("Other", "FR", 6),
    ];
    const imported = [record("Tongyou", "FR", 4), record("YunExpress", "FR", 4.5)];
    const merged = mergeGridCells(active, imported, ["Tongyou", "YunExpress"]);
    expect(merged.map((c) => [c.carrier, c.destination, c.price])).toEqual([
      ["Tongyou", "FR", 4],
      ["YunExpress", "FR", 4.5],
      ["Huahan", "FR", 7],
      ["Other", "FR", 6],
    ]);
    // Single carrier string still works for the assistant path.
    expect(mergeGridCells(active, imported, "Tongyou").map((c) => [c.carrier, c.destination, c.price])).toEqual([
      ["Tongyou", "FR", 4],
      ["YunExpress", "FR", 4.5], // imported wins over the active duplicate
      ["YunExpress", "DE", 8.5],
      ["Huahan", "FR", 7],
      ["Other", "FR", 6],
    ]);
  });
});

describe("carrier detection with notes naming another carrier", () => {
  it("keeps YunExpress for a 商派 column whose notes say « sinon basculer Tongyou »", async () => {
    const XLSX = await import("xlsx");
    const { parseVoltshipMatrix } = await import("./matrix-import");
    const ws = XLSX.utils.aoa_to_sheet([
      ["Carrier", "TONGYOU ★ NEW", "YUNEXPRESS ★ NEW"],
      ["Tier / Service", "美国专线特惠普 (direct 24/09)", "商派特惠普货 YTSPTHPH (plancher 29/09)"],
      ["Delivery", "12-15 d", "6-12工作日"],
      ["Size limits", "Taxes incluses", "⚠ ~80 % des codes postaux US seulement — sinon basculer Tongyou"],
      ["Weight (g)", "direct", "direct"],
      [50, 20, 18],
      [100, 22, 19],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "USA-STANDARD");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const { lines } = parseVoltshipMatrix(buffer);
    expect(lines.map((line) => line.carrier)).toEqual(["Tongyou", "YunExpress"]);
    expect(lines[1].line_name).toBe("YunExpress 商派特惠普货 YTSPTHPH");
  });
});
