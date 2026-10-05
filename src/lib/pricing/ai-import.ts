import { findRateCell, normalizeDestination, type RateCell, type ShippingChannel } from "../domain/pricing";
import type { RateGridCsvRow } from "../domain/rate-grid-csv";
import { DEFAULT_PRICING_SETTINGS, parsePricingSettings, type PricingSettings } from "./settings";
import { isSpreadsheetFile, spreadsheetToText } from "./spreadsheet-text";

/**
 * AI-assisted carrier price list import.
 *
 * 1. `parseCarrierPriceList` sends the raw list (text / images / PDF) to Claude and gets
 *    back a strict JSON structure (`ParsedPriceList`).
 * 2. `expandToCells` turns every line into rate-grid cells (50 g steps up to 2 kg, then
 *    500 g steps to 5 kg) priced in EUR with Voltship's margin rule.
 * 3. `compareWithActive` compares the cheapest carrier per destination/channel at a few
 *    reference weights against the currently active grid.
 *
 * Everything but step 1 is pure and unit-tested.
 */

// ---------------------------------------------------------------------------
// Model output contract
// ---------------------------------------------------------------------------

export const CHANNELS: ShippingChannel[] = [
  "standard",
  "electronics_battery",
  "cosmetics",
  "liquid_perfume",
  "magnetic",
  "sensitive_other",
];

export const KNOWN_CARRIERS = ["4PX", "YunExpress", "Tongyou", "Huahan"] as const;

export type ParsedTier = { min_g: number; max_g: number; per_kg: number; fee: number };

export type ParsedPricing =
  | { type: "per_kg_plus_fee"; per_kg: number; fee: number; tiers?: ParsedTier[] }
  | { type: "table"; rows: { min_g: number; max_g: number; price: number }[] };

export type ParsedLine = {
  line_name: string;
  /** Carrier of this line when the list mixes carriers (Voltship matrix); else the list's carrier. */
  carrier?: string | null;
  /** ISO-3166 alpha-2 (FR, DE, BE, IT, US, PT, ES…). */
  destination: string;
  channel: ShippingChannel;
  /** false → the EU per-parcel tax is added so grids compare like-for-like. */
  tax_included: boolean;
  /** true → "VAT on declared value extra"; excluded from cheapest selection by default. */
  vat_extra: boolean;
  /** Ships under the client's IOSS number (informational badge, never a cost). */
  ioss_required?: boolean;
  pricing: ParsedPricing;
  delivery_range?: string | null;
  notes?: string | null;
  /** Minimum billable weight in grams when the carrier states one (USA: 50 g). */
  min_billable_g?: number | null;
  /** Volumetric divisor (e.g. 8000 for Tongyou, 6000 for Huahan). Stored in notes, never applied. */
  volumetric_divisor?: number | null;
  /** 0–1 */
  confidence: number;
};

export type ParsedPriceList = {
  carrier: string;
  /** ISO date of the price list when stated, else null. */
  grid_date: string | null;
  currency: "RMB";
  /**
   * true for the Voltship matrix ("TOUT COMPRIS"): every price is the final carrier cost,
   * no supplement is ever added and the review cannot flip a tax flag.
   */
  all_inclusive?: boolean;
  lines: ParsedLine[];
  warnings: string[];
};

/** JSON schema handed to the model (also documented in the README). */
export const PRICE_LIST_JSON_SCHEMA = {
  type: "object",
  required: ["carrier", "grid_date", "currency", "lines", "warnings"],
  properties: {
    carrier: { type: "string", enum: [...KNOWN_CARRIERS, "other"] },
    grid_date: { type: ["string", "null"], description: "YYYY-MM-DD when stated" },
    currency: { type: "string", const: "RMB" },
    lines: {
      type: "array",
      items: {
        type: "object",
        required: ["line_name", "destination", "channel", "tax_included", "vat_extra", "pricing", "confidence"],
        properties: {
          line_name: { type: "string" },
          destination: { type: "string", pattern: "^[A-Z]{2}$" },
          channel: { type: "string", enum: CHANNELS },
          tax_included: { type: "boolean" },
          vat_extra: { type: "boolean" },
          pricing: {
            oneOf: [
              {
                type: "object",
                required: ["type", "per_kg", "fee"],
                properties: {
                  type: { const: "per_kg_plus_fee" },
                  per_kg: { type: "number", description: "RMB per kg" },
                  fee: { type: "number", description: "RMB per parcel" },
                  tiers: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["min_g", "max_g", "per_kg", "fee"],
                      properties: {
                        min_g: { type: "integer" },
                        max_g: { type: "integer" },
                        per_kg: { type: "number" },
                        fee: { type: "number" },
                      },
                    },
                  },
                },
              },
              {
                type: "object",
                required: ["type", "rows"],
                properties: {
                  type: { const: "table" },
                  rows: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["min_g", "max_g", "price"],
                      properties: {
                        min_g: { type: "integer" },
                        max_g: { type: "integer" },
                        price: { type: "number", description: "RMB per parcel for this bracket" },
                      },
                    },
                  },
                },
              },
            ],
          },
          delivery_range: { type: ["string", "null"], description: 'e.g. "8-12 days"' },
          notes: { type: ["string", "null"] },
          min_billable_g: { type: ["integer", "null"] },
          volumetric_divisor: { type: ["integer", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;

export const PRICE_LIST_SYSTEM_PROMPT = `You convert Chinese cross-border carrier price lists (4PX, YunExpress 云途, Tongyou 通邮, Huahan 华翰) into a strict JSON structure for Voltship Logistics, a 3PL in Shenzhen shipping parcels to Europe and the USA.

Output exactly one JSON object matching this JSON schema:
${JSON.stringify(PRICE_LIST_JSON_SCHEMA)}

Rules:
- Currency is always RMB. Prices are per parcel: "per_kg_plus_fee" means price = fee + per_kg × weight_kg (the common 运费 + 挂号费 / 处理费 form). Use "table" when the source already lists a price per weight bracket (grams). Use "tiers" when per_kg / fee differ by weight range.
- One line per (service line × destination × product category). Destinations as ISO-3166 alpha-2: 法国/France→FR, 德国/Germany→DE, 比利时/Belgium→BE, 意大利/Italy→IT, 美国/USA→US, 葡萄牙/Portugal→PT, 西班牙/Spain→ES, 荷兰→NL, 英国→GB.
- Product category → channel: 普货/普通/general/standard → "standard"; 带电/内电/配电/电池/battery/electronics → "electronics_battery"; 化妆品/cosmetics → "cosmetics"; 液体/香水/liquid/perfume → "liquid_perfume"; 带磁/磁性/magnetic → "magnetic"; 特敏/敏感/保健品/食品/food supplements/sensitive → "sensitive_other". Textile/clothing (纺织/服装) → "standard" unless the list has a specific textile line; then "sensitive_other" with a note.
- tax_included: false when the line is explicitly not tax-inclusive (不含税, 不包税, 关税另计, DDU, e.g. YunExpress CHC, 4PX O5 / JW); true for 包税 / DDP / IOSS-inclusive lines or when nothing says otherwise.
- vat_extra: true only when VAT on the declared value is billed on top (e.g. Huahan 智惠选). Add a note.
- min_billable_g: the stated minimum billable weight (USA lines are usually 50 g). volumetric_divisor: the stated 体积重 divisor (Tongyou 8000, Huahan 6000) — report it, do not apply it.
- delivery_range: the stated transit time, e.g. "8-12 days".
- confidence: 1.0 when every number was read unambiguously, lower when the layout was unclear, a number was cut off, or you had to guess the category or destination. Put any doubt in "notes" and overall issues in "warnings".
- Spreadsheet matrices: sheet names usually encode country × category (e.g. "法国-普货", "DE battery"); the first column is the weight in grams and each other column is a carrier line (price per parcel in RMB → "table" rows, min_g = previous row + 1). Emit one line per carrier column per sheet.
- Never invent lines or numbers. Skip lines for destinations outside Europe/USA unless asked.`;

// ---------------------------------------------------------------------------
// Normalisation of the model reply
// ---------------------------------------------------------------------------

const CHANNEL_ALIASES: Record<string, ShippingChannel> = {
  standard: "standard",
  general: "standard",
  normal: "standard",
  普货: "standard",
  普通: "standard",
  textile: "standard",
  clothing: "standard",
  electronics_battery: "electronics_battery",
  electronics: "electronics_battery",
  battery: "electronics_battery",
  带电: "electronics_battery",
  内电: "electronics_battery",
  配电: "electronics_battery",
  cosmetics: "cosmetics",
  cosmetic: "cosmetics",
  化妆品: "cosmetics",
  liquid_perfume: "liquid_perfume",
  liquid: "liquid_perfume",
  perfume: "liquid_perfume",
  液体: "liquid_perfume",
  香水: "liquid_perfume",
  magnetic: "magnetic",
  带磁: "magnetic",
  sensitive_other: "sensitive_other",
  sensitive: "sensitive_other",
  特敏: "sensitive_other",
  敏感: "sensitive_other",
  保健品: "sensitive_other",
  food_supplements: "sensitive_other",
  supplements: "sensitive_other",
};

export function normalizeChannel(value: unknown): ShippingChannel | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return CHANNEL_ALIASES[key] ?? CHANNEL_ALIASES[value.trim()] ?? null;
}

function num(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value.replace(/[^\d.-]/g, "")) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function int(value: unknown): number | null {
  const parsed = num(value);
  return parsed == null ? null : Math.round(parsed);
}

function normalizePricing(raw: unknown): ParsedPricing | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (p.type === "table") {
    const rows = Array.isArray(p.rows)
      ? p.rows
          .map((row) => {
            const r = (row ?? {}) as Record<string, unknown>;
            const min_g = int(r.min_g);
            const max_g = int(r.max_g);
            const price = num(r.price);
            if (min_g == null || max_g == null || price == null || max_g < min_g || price < 0) return null;
            return { min_g: Math.max(0, min_g), max_g, price };
          })
          .filter((row): row is { min_g: number; max_g: number; price: number } => row != null)
          .sort((a, b) => a.min_g - b.min_g)
      : [];
    return rows.length > 0 ? { type: "table", rows } : null;
  }
  if (p.type === "per_kg_plus_fee") {
    const per_kg = num(p.per_kg);
    const fee = num(p.fee);
    const tiers = Array.isArray(p.tiers)
      ? p.tiers
          .map((tier) => {
            const t = (tier ?? {}) as Record<string, unknown>;
            const min_g = int(t.min_g);
            const max_g = int(t.max_g);
            const tierPerKg = num(t.per_kg);
            const tierFee = num(t.fee);
            if (min_g == null || max_g == null || tierPerKg == null || tierFee == null || max_g < min_g) {
              return null;
            }
            return { min_g: Math.max(0, min_g), max_g, per_kg: tierPerKg, fee: tierFee };
          })
          .filter((tier): tier is ParsedTier => tier != null)
          .sort((a, b) => a.min_g - b.min_g)
      : [];
    if (tiers.length > 0) {
      return { type: "per_kg_plus_fee", per_kg: per_kg ?? tiers[0].per_kg, fee: fee ?? tiers[0].fee, tiers };
    }
    if (per_kg == null || fee == null || per_kg < 0 || fee < 0) return null;
    return { type: "per_kg_plus_fee", per_kg, fee };
  }
  return null;
}

/**
 * Validate / coerce the model JSON into `ParsedPriceList`. Unusable lines are dropped
 * and reported in `warnings` rather than failing the whole import.
 */
export function normalizeParsedPriceList(raw: unknown, carrierHint?: string | null): ParsedPriceList {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const warnings = Array.isArray(source.warnings)
    ? source.warnings.filter((w): w is string => typeof w === "string")
    : [];
  const carrierRaw = typeof source.carrier === "string" ? source.carrier.trim() : "";
  const carrier = normalizeCarrier(carrierRaw) ?? normalizeCarrier(carrierHint ?? "") ?? carrierRaw ?? "other";
  const gridDateRaw = typeof source.grid_date === "string" ? source.grid_date.trim() : "";
  const grid_date = /^\d{4}-\d{2}-\d{2}$/.test(gridDateRaw) ? gridDateRaw : null;

  const lines: ParsedLine[] = [];
  const rawLines = Array.isArray(source.lines) ? source.lines : [];
  rawLines.forEach((item, index) => {
    const l = (item ?? {}) as Record<string, unknown>;
    const destination = normalizeDestination(String(l.destination ?? ""), "");
    const channel = normalizeChannel(l.channel);
    const pricing = normalizePricing(l.pricing);
    const problems: string[] = [];
    if (!/^[A-Z]{2}$/.test(destination)) problems.push("destination");
    if (!channel) problems.push("channel");
    if (!pricing) problems.push("pricing");
    if (problems.length > 0 || !channel || !pricing) {
      warnings.push(`Line ${index + 1} (${String(l.line_name ?? "?")}) skipped: invalid ${problems.join(", ")}.`);
      return;
    }
    const confidenceRaw = num(l.confidence);
    const lineCarrierRaw = typeof l.carrier === "string" ? l.carrier.trim() : "";
    lines.push({
      line_name: String(l.line_name ?? carrier).trim() || carrier,
      carrier: lineCarrierRaw ? (normalizeCarrier(lineCarrierRaw) ?? lineCarrierRaw) : null,
      destination,
      channel,
      tax_included: source.all_inclusive === true || l.tax_included !== false,
      vat_extra: source.all_inclusive === true ? false : l.vat_extra === true,
      ioss_required: l.ioss_required === true,
      pricing,
      delivery_range: typeof l.delivery_range === "string" && l.delivery_range.trim() ? l.delivery_range.trim() : null,
      notes: typeof l.notes === "string" && l.notes.trim() ? l.notes.trim() : null,
      min_billable_g: int(l.min_billable_g),
      volumetric_divisor: int(l.volumetric_divisor),
      confidence: confidenceRaw == null ? 0.5 : Math.min(1, Math.max(0, confidenceRaw)),
    });
  });

  return {
    carrier,
    grid_date,
    currency: "RMB",
    ...(source.all_inclusive === true ? { all_inclusive: true } : {}),
    lines,
    warnings,
  };
}

export function normalizeCarrier(value: string): string | null {
  const key = value.trim().toLowerCase();
  if (!key) return null;
  if (key.includes("4px") || key.includes("递四方")) return "4PX";
  if (key.includes("yun") || key.includes("云途")) return "YunExpress";
  if (key.includes("tongyou") || key.includes("通邮")) return "Tongyou";
  if (key.includes("huahan") || key.includes("华翰")) return "Huahan";
  return null;
}

// ---------------------------------------------------------------------------
// Margin rule + weight tiers
// ---------------------------------------------------------------------------

export const DEFAULT_US_MIN_BILLABLE_G = 50;

/** Round to the nearest 0.05 EUR. */
export function roundTo05(value: number) {
  return Math.round((value + Number.EPSILON) * 20) / 20;
}

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

/**
 * Voltship margin rule:
 *   cost_eur = cost_rmb / fx
 *   price    = round_0.05(cost_eur + max(cost_eur × margin% , min_margin) + (tax_included ? 0 : eu_tax))
 */
export function priceFromCarrierCost(
  carrierCostRmb: number,
  taxIncluded: boolean,
  settings: PricingSettings = DEFAULT_PRICING_SETTINGS,
) {
  const costEur = carrierCostRmb / settings.fx_rmb_per_eur;
  const margin = Math.max(costEur * (settings.margin_pct / 100), settings.min_margin_eur_per_parcel);
  const tax = taxIncluded ? 0 : settings.eu_parcel_tax_eur;
  return roundTo05(costEur + margin + tax);
}

export type WeightBracket = { min_g: number; max_g: number };

/** 50 g steps to 2 000 g, then 500 g steps to `maxG` (default 5 000 g). */
export function defaultWeightBrackets(maxG = 5000): WeightBracket[] {
  const brackets: WeightBracket[] = [];
  let previous = 0;
  const push = (max: number) => {
    brackets.push({ min_g: previous === 0 ? 0 : previous + 1, max_g: max });
    previous = max;
  };
  for (let max = 50; max <= Math.min(2000, maxG); max += 50) push(max);
  if (maxG > 2000) {
    for (let max = 2500; max <= maxG; max += 500) push(max);
    if (previous < maxG) push(maxG);
  }
  return brackets;
}

/** Carrier cost in RMB for a parcel of `weightG` on a per-kg+fee line. */
export function carrierCostForWeight(pricing: Extract<ParsedPricing, { type: "per_kg_plus_fee" }>, weightG: number) {
  const tier = pricing.tiers?.find((t) => weightG >= t.min_g && weightG <= t.max_g);
  if (pricing.tiers && pricing.tiers.length > 0 && !tier) return null;
  const perKg = tier?.per_kg ?? pricing.per_kg;
  const fee = tier?.fee ?? pricing.fee;
  return round4(fee + perKg * (weightG / 1000));
}

export type ProposedCell = RateGridCsvRow & {
  lineIndex: number;
  lineName: string;
  taxIncluded: boolean;
  vatExtra: boolean;
  iossRequired: boolean;
  notes: string | null;
  carrierCostRmb: number;
  confidence: number;
};

export type LineOverride = { include?: boolean; tax_included?: boolean };
export type ImportOverrides = {
  lines?: Record<string, LineOverride>;
  settings?: Partial<PricingSettings>;
};

export function resolveSettings(base: PricingSettings, overrides?: ImportOverrides) {
  return parsePricingSettings({ ...base, ...(overrides?.settings ?? {}) });
}

export function isLineIncluded(line: ParsedLine, override?: LineOverride) {
  if (override?.include != null) return override.include;
  // "VAT on declared value extra" lines are out of the cheapest selection by default.
  return !line.vat_extra;
}

export function lineTaxIncluded(line: ParsedLine, override?: LineOverride, allInclusive = false) {
  if (allInclusive) return true;
  return override?.tax_included ?? line.tax_included;
}

/** Carrier a line's cells are written under. */
export function lineCarrier(parsed: Pick<ParsedPriceList, "carrier">, line: ParsedLine) {
  return line.carrier?.trim() || parsed.carrier;
}

/**
 * Every carrier the import covers (all parsed lines, included or not): on activation their
 * active cells are replaced, every other carrier is carried forward.
 */
export function importedCarriers(parsed: ParsedPriceList): string[] {
  const set = new Set<string>();
  for (const line of parsed.lines) set.add(lineCarrier(parsed, line));
  if (set.size === 0) set.add(parsed.carrier);
  return [...set].sort();
}

/** Line counts per carrier (all lines / included lines). */
export function linesPerCarrier(parsed: ParsedPriceList, overrides?: ImportOverrides) {
  const out: Record<string, { lines: number; included: number }> = {};
  parsed.lines.forEach((line, index) => {
    const carrier = lineCarrier(parsed, line);
    out[carrier] ??= { lines: 0, included: 0 };
    out[carrier].lines += 1;
    if (isLineIncluded(line, overrides?.lines?.[String(index)])) out[carrier].included += 1;
  });
  return out;
}

function carrierSet(carriers: string | Iterable<string> | null | undefined): Set<string> {
  if (carriers == null) return new Set();
  return new Set(typeof carriers === "string" ? [carriers] : carriers);
}

function lineNotes(line: ParsedLine) {
  const parts: string[] = [];
  if (line.notes) parts.push(line.notes);
  if (line.vat_extra) parts.push("VAT on declared value billed extra");
  if (line.volumetric_divisor) parts.push(`Volumetric divisor ${line.volumetric_divisor} (not applied)`);
  if (line.min_billable_g) parts.push(`Min billable ${line.min_billable_g} g`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Expand every included line into priced grid cells. Per-kg lines are sampled at the
 * bracket's max weight (what the carrier would bill for a parcel in that bracket);
 * tabular sources keep their original brackets.
 */
export function expandToCells(
  parsed: ParsedPriceList,
  settings: PricingSettings = DEFAULT_PRICING_SETTINGS,
  overrides?: ImportOverrides,
): ProposedCell[] {
  const resolved = resolveSettings(settings, overrides);
  const cells: ProposedCell[] = [];

  parsed.lines.forEach((line, lineIndex) => {
    const override = overrides?.lines?.[String(lineIndex)];
    if (!isLineIncluded(line, override)) return;
    const taxIncluded = lineTaxIncluded(line, override, parsed.all_inclusive === true);
    const minBillable =
      line.min_billable_g ?? (line.destination === "US" ? DEFAULT_US_MIN_BILLABLE_G : 0);
    const base = {
      lineIndex,
      carrier: lineCarrier(parsed, line),
      destination: line.destination,
      channel: line.channel,
      deliveryRange: line.delivery_range ?? null,
      lineName: line.line_name,
      taxIncluded,
      vatExtra: line.vat_extra,
      iossRequired: line.ioss_required === true,
      notes: lineNotes(line),
      confidence: line.confidence,
    };

    if (line.pricing.type === "table") {
      for (const row of line.pricing.rows) {
        cells.push({
          ...base,
          weightMinG: row.min_g,
          weightMaxG: row.max_g,
          carrierCostRmb: round4(row.price),
          price: priceFromCarrierCost(row.price, taxIncluded, resolved),
        });
      }
      return;
    }

    const pricing = line.pricing;
    const tiersMax = pricing.tiers?.length ? Math.max(...pricing.tiers.map((t) => t.max_g)) : 5000;
    const brackets = defaultWeightBrackets(Math.max(5000, Math.min(30_000, tiersMax)));
    for (const bracket of brackets) {
      if (pricing.tiers?.length) {
        const tiersMin = Math.min(...pricing.tiers.map((t) => t.min_g));
        if (bracket.max_g < tiersMin || bracket.max_g > tiersMax) continue;
      }
      const billable = Math.max(bracket.max_g, minBillable);
      const cost = carrierCostForWeight(pricing, billable);
      if (cost == null) continue;
      cells.push({
        ...base,
        weightMinG: bracket.min_g,
        weightMaxG: bracket.max_g,
        carrierCostRmb: cost,
        price: priceFromCarrierCost(cost, taxIncluded, resolved),
      });
    }
  });

  return cells;
}

/** Carrier price-list rows → RateCell shape for the domain engine. */
export function toRateCells(cells: ProposedCell[], gridVersion = "proposed"): RateCell[] {
  return cells.map((cell) => ({
    gridVersion,
    carrier: cell.carrier,
    destination: cell.destination,
    channel: cell.channel,
    weightMinG: cell.weightMinG,
    weightMaxG: cell.weightMaxG,
    price: cell.price,
    deliveryRange: cell.deliveryRange,
    lineName: cell.lineName,
    iossRequired: cell.iossRequired,
  }));
}

// ---------------------------------------------------------------------------
// Carry-forward: new grid = imported carrier + every other carrier of the active grid
// ---------------------------------------------------------------------------

/** Cell shape written to rate_grid_cells (also what the active grid is read back as). */
export type GridCellRecord = {
  carrier: string;
  destination: string;
  channel: ShippingChannel;
  weightMinG: number;
  weightMaxG: number;
  price: number;
  deliveryRange: string | null;
  lineName: string | null;
  taxIncluded: boolean;
  notes: string | null;
  carrierCostRmb: number | null;
  iossRequired: boolean;
};

export function proposedToRecords(cells: ProposedCell[]): GridCellRecord[] {
  return cells.map((cell) => ({
    carrier: cell.carrier,
    destination: cell.destination,
    channel: cell.channel,
    weightMinG: cell.weightMinG,
    weightMaxG: cell.weightMaxG,
    price: cell.price,
    deliveryRange: cell.deliveryRange,
    lineName: cell.lineName,
    taxIncluded: cell.taxIncluded,
    notes: cell.notes,
    carrierCostRmb: cell.carrierCostRmb,
    iossRequired: cell.iossRequired,
  }));
}

/**
 * Cells of the next grid: every active cell whose carrier is not one of `carriers` (copied
 * forward with line_name / tax_included / notes / carrier_cost_rmb / delivery_range) + the
 * imported cells. Duplicates on (carrier, line_name, destination, channel, min, max) keep the
 * imported one — two lines of one carrier (YunExpress THPHR vs 商派) stay distinct cells and
 * `findRateCell` picks the cheaper. `carriers` is one carrier (assistant import) or the set of carriers of a multi-carrier
 * import (Voltship matrix).
 */
export function mergeGridCells(
  activeCells: GridCellRecord[],
  importedCells: GridCellRecord[],
  carriers: string | Iterable<string>,
): GridCellRecord[] {
  const replaced = carrierSet(carriers);
  const key = (c: GridCellRecord) =>
    [c.carrier, c.lineName ?? "", c.destination, c.channel, c.weightMinG, c.weightMaxG].join("|");
  const seen = new Set<string>();
  const out: GridCellRecord[] = [];
  for (const cell of importedCells) {
    const k = key(cell);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(cell);
  }
  for (const cell of activeCells) {
    if (replaced.has(cell.carrier)) continue;
    const k = key(cell);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...cell });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Comparison with the active grid
// ---------------------------------------------------------------------------

export const REFERENCE_WEIGHTS_G = [100, 250, 500, 1000] as const;

export type ComparisonPick = { carrier: string; lineName: string | null; price: number };

export type ComparisonRow = {
  destination: string;
  channel: ShippingChannel;
  weightG: number;
  old: ComparisonPick | null;
  new: ComparisonPick | null;
  /** (new − old) / old × 100, null when either side is missing. */
  deltaPct: number | null;
};

function pick(cell: RateCell | null): ComparisonPick | null {
  return cell ? { carrier: cell.carrier, lineName: cell.lineName ?? null, price: cell.price } : null;
}

/**
 * For every (destination, channel) present in the proposal, the cheapest carrier at the
 * reference weights on the active grid vs. on the active grid where the proposal's
 * carrier(s) are replaced by the new cells (other carriers stay as they are).
 */
export function compareWithActive(
  proposed: ProposedCell[],
  activeCells: RateCell[],
  weights: readonly number[] = REFERENCE_WEIGHTS_G,
  carriers: string | Iterable<string> | null = [...new Set(proposed.map((cell) => cell.carrier))],
): ComparisonRow[] {
  // Same rule as mergeGridCells / activation: the imported carriers are replaced, the
  // other carriers of the active grid are carried forward.
  const replaced = carrierSet(carriers);
  const proposedCells = toRateCells(proposed);
  const merged = [
    ...activeCells.filter((cell) => !replaced.has(cell.carrier)),
    ...proposedCells,
  ];
  const keys = new Map<string, { destination: string; channel: ShippingChannel }>();
  for (const cell of proposed) {
    keys.set(`${cell.destination}|${cell.channel}`, { destination: cell.destination, channel: cell.channel });
  }

  const rows: ComparisonRow[] = [];
  for (const { destination, channel } of [...keys.values()].sort((a, b) =>
    `${a.destination}${a.channel}`.localeCompare(`${b.destination}${b.channel}`),
  )) {
    for (const weightG of weights) {
      const query = { weightG, channel, destination };
      const oldPick = pick(findRateCell(activeCells, query));
      const newPick = pick(findRateCell(merged, query));
      rows.push({
        destination,
        channel,
        weightG,
        old: oldPick,
        new: newPick,
        deltaPct:
          oldPick && newPick && oldPick.price > 0
            ? Math.round(((newPick.price - oldPick.price) / oldPick.price) * 1000) / 10
            : null,
      });
    }
  }
  return rows;
}

export function hasLowConfidence(parsed: ParsedPriceList, overrides?: ImportOverrides, threshold = 0.5) {
  return parsed.lines.some(
    (line, index) =>
      isLineIncluded(line, overrides?.lines?.[String(index)]) && line.confidence < threshold,
  );
}

export type ImportSummary = {
  cells: number;
  lines: number;
  includedLines: number;
  lowConfidenceLines: number;
  notTaxIncludedLines: number;
  vatExtraLines: number;
  destinations: string[];
  channels: ShippingChannel[];
  /** Carriers the import covers (cells are written under these; their active cells are replaced). */
  carriers: string[];
  perCarrier: Record<string, { lines: number; included: number }>;
};

export function summarizeImport(parsed: ParsedPriceList, cells: ProposedCell[], overrides?: ImportOverrides): ImportSummary {
  const included = parsed.lines
    .map((line, index) => ({ line, override: overrides?.lines?.[String(index)] }))
    .filter(({ line, override }) => isLineIncluded(line, override));
  return {
    cells: cells.length,
    lines: parsed.lines.length,
    includedLines: included.length,
    lowConfidenceLines: included.filter(({ line }) => line.confidence < 0.5).length,
    notTaxIncludedLines: included.filter(
      ({ line, override }) => !lineTaxIncluded(line, override, parsed.all_inclusive === true),
    ).length,
    vatExtraLines: included.filter(({ line }) => line.vat_extra).length,
    destinations: [...new Set(cells.map((cell) => cell.destination))].sort(),
    channels: [...new Set(cells.map((cell) => cell.channel))].sort() as ShippingChannel[],
    carriers: importedCarriers(parsed),
    perCarrier: linesPerCarrier(parsed, overrides),
  };
}

/** `V13-2026-10-04-tongyou` */
export function buildGridVersion(sequence: number, carrier: string, date = new Date()) {
  const slug = carrier.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "grid";
  return `V${sequence}-${date.toISOString().slice(0, 10)}-${slug}`;
}

// ---------------------------------------------------------------------------
// Model call (server only — the only non-pure function in this module)
// ---------------------------------------------------------------------------

export type PriceListFile = { name: string; mime: string; base64: string };

export type ParseCarrierPriceListInput = {
  carrier?: string | null;
  text?: string | null;
  files?: PriceListFile[];
  hint?: string | null;
};

export type ParseCarrierPriceListResult = {
  parsed: ParsedPriceList;
  modelOutput: unknown;
  model: string;
  inputs: { text: boolean; files: { name: string; mime: string }[] };
};

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const TEXT_MIMES = new Set(["text/plain", "text/csv", "text/markdown", "application/json"]);

export async function parseCarrierPriceList(
  input: ParseCarrierPriceListInput,
): Promise<ParseCarrierPriceListResult> {
  const { createJsonMessage } = await import("../ai/anthropic");
  type AssistantInput = Parameters<typeof createJsonMessage>[0]["inputs"][number];

  const inputs: AssistantInput[] = [];
  const header: string[] = [];
  if (input.carrier) header.push(`Carrier (admin selection): ${input.carrier}`);
  if (input.hint) header.push(`Admin note: ${input.hint}`);
  header.push(`Today: ${new Date().toISOString().slice(0, 10)}`);
  inputs.push({ type: "text", text: header.join("\n") });

  if (input.text?.trim()) {
    inputs.push({ type: "text", text: `Pasted price list:\n\n${input.text.trim()}` });
  }
  for (const file of input.files ?? []) {
    const mime = file.mime.toLowerCase();
    if (IMAGE_MIMES.has(mime)) {
      inputs.push({ type: "image", mime: mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp", base64: file.base64 });
    } else if (mime === "application/pdf") {
      inputs.push({ type: "pdf", base64: file.base64, title: file.name });
    } else if (isSpreadsheetFile(file.name, mime)) {
      inputs.push({
        type: "text",
        text: `Spreadsheet ${file.name} (one block per sheet; first row is the header):\n\n${spreadsheetToText(
          Buffer.from(file.base64, "base64"),
        )}`,
      });
    } else if (TEXT_MIMES.has(mime) || /\.(txt|csv|md|json)$/i.test(file.name)) {
      inputs.push({
        type: "text",
        text: `File ${file.name}:\n\n${Buffer.from(file.base64, "base64").toString("utf8")}`,
      });
    } else {
      throw new Error(`Unsupported file type for ${file.name} (${file.mime}). Use PDF, JPEG, PNG, XLSX, CSV or text.`);
    }
  }
  if (inputs.length < 2) throw new Error("Nothing to parse: paste the price list or attach a file.");

  const result = await createJsonMessage<unknown>({ system: PRICE_LIST_SYSTEM_PROMPT, inputs });
  const parsed = normalizeParsedPriceList(result.json, input.carrier);
  return {
    parsed,
    modelOutput: result.json,
    model: result.model,
    inputs: {
      text: Boolean(input.text?.trim()),
      files: (input.files ?? []).map((file) => ({ name: file.name, mime: file.mime })),
    },
  };
}
