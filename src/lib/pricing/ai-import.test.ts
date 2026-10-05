import { describe, expect, it } from "vitest";
import type { RateCell } from "../domain/pricing";
import {
  buildGridVersion,
  carrierCostForWeight,
  compareWithActive,
  defaultWeightBrackets,
  expandToCells,
  hasLowConfidence,
  mergeGridCells,
  normalizeChannel,
  normalizeParsedPriceList,
  priceFromCarrierCost,
  roundTo05,
  summarizeImport,
  type GridCellRecord,
  type ParsedPriceList,
} from "./ai-import";
import { DEFAULT_PRICING_SETTINGS } from "./settings";

/** What the model would return for a small Tongyou list (RMB). */
const fixture: ParsedPriceList = {
  carrier: "Tongyou",
  grid_date: "2026-09-24",
  currency: "RMB",
  warnings: [],
  lines: [
    {
      line_name: "通邮 普货专线",
      destination: "FR",
      channel: "standard",
      tax_included: true,
      vat_extra: false,
      pricing: { type: "per_kg_plus_fee", per_kg: 60, fee: 18 },
      delivery_range: "8-12 days",
      volumetric_divisor: 8000,
      confidence: 0.95,
    },
    {
      line_name: "通邮 带电专线",
      destination: "DE",
      channel: "electronics_battery",
      tax_included: false,
      vat_extra: false,
      pricing: {
        type: "per_kg_plus_fee",
        per_kg: 0,
        fee: 0,
        tiers: [
          { min_g: 0, max_g: 500, per_kg: 70, fee: 20 },
          { min_g: 501, max_g: 2000, per_kg: 65, fee: 22 },
        ],
      },
      confidence: 0.8,
    },
    {
      line_name: "通邮 美国专线",
      destination: "US",
      channel: "standard",
      tax_included: true,
      vat_extra: false,
      pricing: { type: "per_kg_plus_fee", per_kg: 100, fee: 30 },
      confidence: 0.4,
    },
    {
      line_name: "通邮 智惠选",
      destination: "FR",
      channel: "standard",
      tax_included: true,
      vat_extra: true,
      pricing: {
        type: "table",
        rows: [
          { min_g: 0, max_g: 300, price: 25 },
          { min_g: 301, max_g: 1000, price: 60 },
        ],
      },
      confidence: 1,
    },
  ],
};

describe("margin rule", () => {
  it("rounds to 0.05", () => {
    expect(roundTo05(3.9249)).toBe(3.9);
    expect(roundTo05(3.925)).toBe(3.95);
    expect(roundTo05(10)).toBe(10);
  });

  it("applies cost/fx + max(pct, min margin)", () => {
    // 75 RMB / 7.5 = 10 € ; 12 % = 1.20 < 1.50 → 11.50
    expect(priceFromCarrierCost(75, true)).toBe(11.5);
    // 150 RMB / 7.5 = 20 € ; 12 % = 2.40 > 1.50 → 22.40
    expect(priceFromCarrierCost(150, true)).toBe(22.4);
  });

  it("adds the manual per-parcel supplement when the line is not tax-inclusive (default 0)", () => {
    expect(priceFromCarrierCost(75, false)).toBe(11.5);
    expect(priceFromCarrierCost(75, false, { ...DEFAULT_PRICING_SETTINGS, eu_parcel_tax_eur: 3 })).toBe(14.5);
    expect(
      priceFromCarrierCost(75, false, { ...DEFAULT_PRICING_SETTINGS, eu_parcel_tax_eur: 2 }),
    ).toBe(13.5);
  });

  it("honours custom fx and margin", () => {
    // 80 RMB / 8 = 10 € ; 20 % = 2 → 12.00
    expect(
      priceFromCarrierCost(80, true, {
        ...DEFAULT_PRICING_SETTINGS,
        fx_rmb_per_eur: 8,
        margin_pct: 20,
        min_margin_eur_per_parcel: 1,
        eu_parcel_tax_eur: 3,
      }),
    ).toBe(12);
  });
});

describe("weight brackets", () => {
  it("steps 50 g to 2 kg then 500 g to 5 kg", () => {
    const brackets = defaultWeightBrackets();
    expect(brackets[0]).toEqual({ min_g: 0, max_g: 50 });
    expect(brackets[1]).toEqual({ min_g: 51, max_g: 100 });
    expect(brackets[39]).toEqual({ min_g: 1951, max_g: 2000 });
    expect(brackets[40]).toEqual({ min_g: 2001, max_g: 2500 });
    expect(brackets.at(-1)).toEqual({ min_g: 4501, max_g: 5000 });
    expect(brackets).toHaveLength(46);
  });

  it("computes per-kg + fee at the bracket weight, with tiers", () => {
    expect(carrierCostForWeight({ type: "per_kg_plus_fee", per_kg: 60, fee: 18 }, 300)).toBe(36);
    const tiered = fixture.lines[1].pricing as Extract<typeof fixture.lines[1]["pricing"], { type: "per_kg_plus_fee" }>;
    expect(carrierCostForWeight(tiered, 500)).toBe(55);
    expect(carrierCostForWeight(tiered, 1000)).toBe(87);
    expect(carrierCostForWeight(tiered, 3000)).toBeNull();
  });
});

describe("expandToCells", () => {
  const cells = expandToCells(fixture);

  it("generates 46 cells for a plain per-kg line and keeps line metadata", () => {
    const fr = cells.filter((cell) => cell.lineIndex === 0);
    expect(fr).toHaveLength(46);
    expect(fr[0]).toMatchObject({
      carrier: "Tongyou",
      destination: "FR",
      channel: "standard",
      lineName: "通邮 普货专线",
      weightMinG: 0,
      weightMaxG: 50,
      carrierCostRmb: 21, // 18 + 60 × 0.05
      taxIncluded: true,
      deliveryRange: "8-12 days",
    });
    // 21 / 7.5 = 2.80 ; margin max(0.336, 1.5) → 4.30
    expect(fr[0].price).toBe(4.3);
    expect(fr[0].notes).toContain("Volumetric divisor 8000");
  });

  it("limits tiered lines to the tier range and adds the EU tax when not tax-inclusive", () => {
    const de = cells.filter((cell) => cell.lineIndex === 1);
    expect(de.at(-1)?.weightMaxG).toBe(2000);
    expect(de).toHaveLength(40);
    const at500 = de.find((cell) => cell.weightMaxG === 500)!;
    expect(at500.carrierCostRmb).toBe(55);
    // 55 / 7.5 = 7.3333 ; margin max(0.88, 1.5) ; supplement 0 by default → 8.8333 → 8.85
    expect(at500.price).toBe(8.85);
    expect(at500.taxIncluded).toBe(false);
    const withSupplement = expandToCells(fixture, { ...DEFAULT_PRICING_SETTINGS, eu_parcel_tax_eur: 3 }).find(
      (cell) => cell.lineIndex === 1 && cell.weightMaxG === 500,
    )!;
    expect(withSupplement.price).toBe(11.85);
  });

  it("applies the 50 g minimum billable weight on US lines", () => {
    const us = cells.filter((cell) => cell.lineIndex === 2);
    expect(us[0].carrierCostRmb).toBe(35); // 30 + 100 × 0.05, same as the 50 g bracket
  });

  it("excludes VAT-extra lines by default and keeps tabular brackets when included", () => {
    expect(cells.some((cell) => cell.lineIndex === 3)).toBe(false);
    const included = expandToCells(fixture, DEFAULT_PRICING_SETTINGS, {
      lines: { "3": { include: true } },
    }).filter((cell) => cell.lineIndex === 3);
    expect(included.map((cell) => [cell.weightMinG, cell.weightMaxG])).toEqual([
      [0, 300],
      [301, 1000],
    ]);
    expect(included[0].notes).toContain("VAT on declared value");
    expect(included[0].vatExtra).toBe(true);
  });

  it("lets the admin override tax_included and settings per import", () => {
    const overridden = expandToCells(fixture, DEFAULT_PRICING_SETTINGS, {
      lines: { "1": { tax_included: true } },
      settings: { margin_pct: 0, min_margin_eur_per_parcel: 0 },
    });
    const at500 = overridden.find((cell) => cell.lineIndex === 1 && cell.weightMaxG === 500)!;
    expect(at500.price).toBe(7.35); // 55 / 7.5 = 7.3333 → 7.35, no margin, no tax
  });

  it("summarises and flags low confidence", () => {
    expect(hasLowConfidence(fixture)).toBe(true);
    expect(hasLowConfidence(fixture, { lines: { "2": { include: false } } })).toBe(false);
    const summary = summarizeImport(fixture, cells);
    expect(summary).toMatchObject({
      lines: 4,
      includedLines: 3,
      lowConfidenceLines: 1,
      notTaxIncludedLines: 1,
      vatExtraLines: 0,
      destinations: ["DE", "FR", "US"],
    });
  });
});

describe("compareWithActive", () => {
  const active: RateCell[] = [
    { gridVersion: "V1", carrier: "Tongyou", destination: "FR", channel: "standard", weightMinG: 0, weightMaxG: 500, price: 5, lineName: "old" },
    { gridVersion: "V1", carrier: "YunExpress", destination: "FR", channel: "standard", weightMinG: 0, weightMaxG: 500, price: 4.5, lineName: "YT" },
    { gridVersion: "V1", carrier: "YunExpress", destination: "FR", channel: "standard", weightMinG: 501, weightMaxG: 1000, price: 9, lineName: "YT" },
  ];

  it("replaces the imported carrier and keeps the others", () => {
    const rows = compareWithActive(expandToCells(fixture).filter((cell) => cell.destination === "FR"), active);
    const fr100 = rows.find((row) => row.destination === "FR" && row.weightG === 100)!;
    expect(fr100.old).toEqual({ carrier: "YunExpress", lineName: "YT", price: 4.5 });
    // new Tongyou at 100 g: 18 + 6 = 24 RMB → 3.2 + 1.5 = 4.70 → YunExpress still cheapest
    expect(fr100.new?.carrier).toBe("YunExpress");
    expect(fr100.deltaPct).toBe(0);

    const fr1000 = rows.find((row) => row.weightG === 1000)!;
    // Tongyou at 1000 g: 78 RMB → 10.4 + 1.5 = 11.90 vs YunExpress 9 → YunExpress
    expect(fr1000.new?.price).toBe(9);
    const fr250 = rows.find((row) => row.weightG === 250)!;
    expect(fr250.new?.carrier).toBe("YunExpress");
    expect(fr250.old?.price).toBe(4.5);
  });

  it("reports null when the active grid has no rate", () => {
    const rows = compareWithActive(expandToCells(fixture).filter((cell) => cell.destination === "DE"), active);
    expect(rows[0].old).toBeNull();
    expect(rows[0].new?.carrier).toBe("Tongyou");
    expect(rows[0].deltaPct).toBeNull();
  });
});

describe("normalizeParsedPriceList", () => {
  it("maps Chinese categories, drops broken lines and reports them", () => {
    const parsed = normalizeParsedPriceList(
      {
        carrier: "云途",
        grid_date: "2026/09/24",
        lines: [
          { line_name: "CHC", destination: "fr", channel: "带电", tax_included: false, pricing: { type: "per_kg_plus_fee", per_kg: "55", fee: "16" }, confidence: 1.4 },
          { line_name: "bad", destination: "France", channel: "普货", pricing: { type: "table", rows: [] } },
        ],
      },
      null,
    );
    expect(parsed.carrier).toBe("YunExpress");
    expect(parsed.grid_date).toBeNull();
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]).toMatchObject({
      destination: "FR",
      channel: "electronics_battery",
      tax_included: false,
      vat_extra: false,
      confidence: 1,
      pricing: { type: "per_kg_plus_fee", per_kg: 55, fee: 16 },
    });
    expect(parsed.warnings[0]).toContain("skipped");
  });

  it("normalizes channel aliases", () => {
    expect(normalizeChannel("Food supplements")).toBe("sensitive_other");
    expect(normalizeChannel("香水")).toBe("liquid_perfume");
    expect(normalizeChannel("unknown")).toBeNull();
  });

  it("builds a readable grid version", () => {
    expect(buildGridVersion(13, "Tongyou", new Date("2026-10-04T10:00:00Z"))).toBe("V13-2026-10-04-tongyou");
  });
});

describe("mergeGridCells (carry-forward)", () => {
  const record = (carrier: string, max: number, price: number, extra: Partial<GridCellRecord> = {}): GridCellRecord => ({
    carrier,
    destination: "FR",
    channel: "standard",
    weightMinG: max - 49,
    weightMaxG: max,
    price,
    deliveryRange: null,
    lineName: null,
    taxIncluded: true,
    notes: null,
    carrierCostRmb: null,
    iossRequired: false,
    ...extra,
  });

  it("keeps the other carriers of the active grid with all their columns and replaces the imported one", () => {
    const active = [
      record("Tongyou", 50, 9),
      record("YunExpress", 50, 4.5, { lineName: "CHC", taxIncluded: false, notes: "n", carrierCostRmb: 20, deliveryRange: "8-12 days" }),
    ];
    const imported = [
      record("Tongyou", 50, 4.3, { lineName: "普货专线" }),
      record("Tongyou", 50, 4.3, { lineName: "普货专线" }),
      record("Tongyou", 50, 4.6, { lineName: "特货专线" }), // second line of the same carrier: kept
    ];
    const merged = mergeGridCells(active, imported, "Tongyou");
    expect(merged).toHaveLength(3);
    expect(merged[0]).toMatchObject({ carrier: "Tongyou", price: 4.3, lineName: "普货专线" });
    expect(merged[1]).toMatchObject({ carrier: "Tongyou", price: 4.6, lineName: "特货专线" });
    expect(merged[2]).toEqual(active[1]);
  });

  it("compareWithActive follows the same rule", () => {
    const active: RateCell[] = [
      { gridVersion: "V1", carrier: "Tongyou", destination: "FR", channel: "standard", weightMinG: 0, weightMaxG: 500, price: 1 },
    ];
    const rows = compareWithActive(expandToCells(fixture).filter((c) => c.destination === "FR"), active, [100], "Tongyou");
    expect(rows[0].old?.price).toBe(1);
    expect(rows[0].new?.price).toBe(4.7); // old Tongyou cell is replaced, not kept
  });
});
