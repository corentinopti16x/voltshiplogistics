import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { RateCell, ShippingChannel } from "@/lib/domain/pricing";
import {
  compareWithActive,
  expandToCells,
  hasLowConfidence,
  importedCarriers,
  normalizeParsedPriceList,
  summarizeImport,
  type ComparisonRow,
  type GridCellRecord,
  type ImportOverrides,
  type ImportSummary,
  type ParsedPriceList,
  type ProposedCell,
} from "./ai-import";
import { getActiveGridVersion } from "./server";
import { parsePricingSettings, readPricingSettings, type PricingSettings } from "./settings";

export type RateImportStatus = "draft" | "reviewed" | "activated" | "discarded";

export type RateImportRow = {
  id: string;
  status: RateImportStatus;
  carrier: string | null;
  destination_hint: string | null;
  raw_text: string | null;
  model_output_json: unknown;
  proposed_cells_json: unknown;
  summary_json: Record<string, unknown> | null;
  grid_version: string | null;
  created_by: string | null;
  created_at: string;
};

/** Everything the review screen needs; recomputed on every override change. */
export type RateImportReview = {
  importId: string;
  status: RateImportStatus;
  carrier: string;
  /** Carriers whose active cells are replaced on activation (one for an assistant import, several for the matrix). */
  carriers: string[];
  hint: string | null;
  createdAt: string;
  gridVersion: string | null;
  activeGridVersion: string | null;
  parsed: ParsedPriceList;
  overrides: ImportOverrides;
  /** Settings actually used for this proposal (defaults merged with per-import overrides). */
  settings: PricingSettings;
  defaultSettings: PricingSettings;
  cells: ProposedCell[];
  comparison: ComparisonRow[];
  summary: ImportSummary;
  lowConfidence: boolean;
  /** Cells of other carriers copied forward from the active grid on activation. */
  carriedForwardCells: number;
  sourceFiles: { name: string; mime: string }[];
  model: string | null;
};

/** Every cell of a grid with the carry-forward columns. */
export async function loadGridCellRecords(gridVersion: string | null): Promise<GridCellRecord[]> {
  if (!gridVersion) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("rate_grid_cells")
    .select(
      "carrier, destination, channel, weight_min_g, weight_max_g, price, delivery_range, line_name, tax_included, notes, carrier_cost_rmb, ioss_required",
    )
    .eq("grid_version", gridVersion);
  return (data ?? []).map((cell) => ({
    carrier: cell.carrier,
    destination: cell.destination,
    channel: cell.channel as ShippingChannel,
    weightMinG: Number(cell.weight_min_g),
    weightMaxG: Number(cell.weight_max_g),
    price: Number(cell.price),
    deliveryRange: cell.delivery_range ?? null,
    lineName: cell.line_name || null,
    taxIncluded: cell.tax_included !== false,
    notes: cell.notes ?? null,
    carrierCostRmb: cell.carrier_cost_rmb == null ? null : Number(cell.carrier_cost_rmb),
    iossRequired: cell.ioss_required === true,
  }));
}

export async function loadActiveRateCells(gridVersion: string | null): Promise<RateCell[]> {
  const records = await loadGridCellRecords(gridVersion);
  return records.map((cell) => ({ gridVersion: gridVersion ?? "", ...cell }));
}

export async function getRateImport(importId: string): Promise<RateImportRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("rate_grid_imports")
    .select(
      "id, status, carrier, destination_hint, raw_text, model_output_json, proposed_cells_json, summary_json, grid_version, created_by, created_at",
    )
    .eq("id", importId)
    .maybeSingle();
  return (data as RateImportRow | null) ?? null;
}

export function readOverrides(summary: Record<string, unknown> | null): ImportOverrides {
  const raw = summary?.overrides;
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const lines: ImportOverrides["lines"] = {};
  if (source.lines && typeof source.lines === "object") {
    for (const [key, value] of Object.entries(source.lines as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      lines[key] = {
        ...(typeof v.include === "boolean" ? { include: v.include } : {}),
        ...(typeof v.tax_included === "boolean" ? { tax_included: v.tax_included } : {}),
      };
    }
  }
  const settings =
    source.settings && typeof source.settings === "object"
      ? (source.settings as Partial<PricingSettings>)
      : undefined;
  return { lines, ...(settings ? { settings } : {}) };
}

/** Parsed list as stored (normalised model output under `summary_json.parsed`). */
export function readParsed(row: RateImportRow): ParsedPriceList {
  const stored = row.summary_json?.parsed;
  return normalizeParsedPriceList(stored ?? row.model_output_json, row.carrier);
}

export async function buildRateImportReview(
  row: RateImportRow,
  overrides: ImportOverrides,
): Promise<RateImportReview> {
  const admin = createAdminClient();
  const [defaultSettings, activeGridVersion] = await Promise.all([
    readPricingSettings(admin),
    getActiveGridVersion(),
  ]);
  const parsed = readParsed(row);
  const settings = parsePricingSettings({ ...defaultSettings, ...(overrides.settings ?? {}) });
  const cells = expandToCells(parsed, settings, overrides);
  const activeCells = await loadActiveRateCells(activeGridVersion);
  const carriers = importedCarriers(parsed);
  const replaced = new Set(carriers);
  const comparison = compareWithActive(cells, activeCells, undefined, carriers);
  const summary = summarizeImport(parsed, cells, overrides);
  const files = Array.isArray(row.summary_json?.source_files)
    ? (row.summary_json?.source_files as { name: string; mime: string }[])
    : [];

  return {
    importId: row.id,
    status: row.status,
    carrier: parsed.carrier,
    carriers,
    hint: row.destination_hint,
    createdAt: row.created_at,
    gridVersion: row.grid_version,
    activeGridVersion,
    parsed,
    overrides,
    settings,
    defaultSettings,
    cells,
    comparison,
    summary,
    lowConfidence: hasLowConfidence(parsed, overrides),
    carriedForwardCells: activeCells.filter((cell) => !replaced.has(cell.carrier)).length,
    sourceFiles: files,
    model: typeof row.summary_json?.model === "string" ? row.summary_json.model : null,
  };
}
