"use server";

import { revalidatePath } from "next/cache";
import { parsePricingTier } from "@/lib/domain/pricing-tiers";
import { isMissingPricingTierColumn } from "@/lib/clients/pricing-tier";
import { getAuthContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/auth/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/app/actions/admin";
import type { ShippingChannel } from "@/lib/domain/pricing";
import { parseRateGridCsv } from "@/lib/domain/rate-grid-csv";
import {
  ASSISTANT_NOT_CONFIGURED,
  AssistantNotConfiguredError,
  isAssistantConfigured,
} from "@/lib/ai/anthropic";
import {
  buildGridVersion,
  expandToCells,
  mergeGridCells,
  parseCarrierPriceList,
  proposedToRecords,
  summarizeImport,
  type ImportOverrides,
  type LineOverride,
  type PriceListFile,
} from "@/lib/pricing/ai-import";
import { isSpreadsheetFile } from "@/lib/pricing/spreadsheet-text";
import { notifyUnavailableCarrierLines } from "@/lib/pricing/carrier-check-server";
import { isVoltshipMatrix, parseVoltshipMatrix, workbookSheetNames } from "@/lib/pricing/matrix-import";
import {
  buildRateImportReview,
  getRateImport,
  loadGridCellRecords,
  readOverrides,
  type RateImportReview,
} from "@/lib/pricing/ai-import-server";
import {
  DEFAULT_PRICING_SETTINGS,
  parsePricingSettings,
  readPricingSettings,
  writePricingSettings,
  type PricingSettings,
} from "@/lib/pricing/settings";

const CHANNELS: ShippingChannel[] = [
  "standard",
  "electronics_battery",
  "cosmetics",
  "liquid_perfume",
  "magnetic",
  "sensitive_other",
];

async function requireAdmin() {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "voltship_admin") {
    return { ctx: null, error: "Admin access required." };
  }
  return { ctx, error: null };
}

function numberField(formData: FormData, key: string, fallback = 0) {
  const value = Number(formData.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function revalidatePricing() {
  revalidatePath("/admin");
  revalidatePath("/admin/pricing");
  revalidatePath("/[locale]/admin/pricing", "page");
  revalidatePath("/products");
  revalidatePath("/[locale]/products/[id]", "page");
}

export async function createRateGridAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error: error ?? "Admin access required." };

  const gridVersion = String(formData.get("grid_version") ?? "").trim();
  const effectiveDate = String(formData.get("effective_date") ?? "").trim();
  const source = String(formData.get("source") ?? "manual").trim() || "manual";
  if (!gridVersion) return { ok: false, error: "Grid version is required." };
  if (!/^\d{4}-\d{2}-\d{2}/.test(effectiveDate)) {
    return { ok: false, error: "Effective date is required." };
  }

  const admin = createAdminClient();
  const { error: insertError } = await admin.from("rate_grids").insert({
    grid_version: gridVersion,
    effective_date: effectiveDate,
    source,
  });
  if (insertError) return { ok: false, error: insertError.message };

  await writeAudit({
    actorUserId: ctx.userId,
    action: "pricing.grid.create",
    entity: "rate_grids",
    diff: { grid_version: gridVersion, effective_date: effectiveDate, source },
  });
  revalidatePricing();
  return { ok: true };
}

export async function upsertRateCellAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error: error ?? "Admin access required." };

  const gridVersion = String(formData.get("grid_version") ?? "").trim();
  const carrier = String(formData.get("carrier") ?? "").trim();
  const destination = String(formData.get("destination") ?? "").trim().toUpperCase();
  const channel = String(formData.get("channel") ?? "standard") as ShippingChannel;
  const weightMinG = numberField(formData, "weight_min_g", -1);
  const weightMaxG = numberField(formData, "weight_max_g", -1);
  const price = numberField(formData, "price", -1);
  const deliveryRange = String(formData.get("delivery_range") ?? "").trim() || null;

  if (!gridVersion || !carrier || destination.length !== 2) {
    return { ok: false, error: "Version, carrier and 2-letter destination are required." };
  }
  if (!CHANNELS.includes(channel)) return { ok: false, error: "Invalid shipping channel." };
  if (weightMinG < 0 || weightMaxG < weightMinG || price < 0) {
    return { ok: false, error: "Check the weight bracket and price." };
  }

  const admin = createAdminClient();
  const { error: upsertError } = await admin.from("rate_grid_cells").upsert(
    {
      grid_version: gridVersion,
      carrier,
      destination,
      channel,
      weight_min_g: weightMinG,
      weight_max_g: weightMaxG,
      price,
      delivery_range: deliveryRange,
    },
    {
      onConflict:
        "grid_version,carrier,destination,channel,weight_min_g,weight_max_g,line_name",
    },
  );
  if (upsertError) return { ok: false, error: upsertError.message };

  await writeAudit({
    actorUserId: ctx.userId,
    action: "pricing.cell.upsert",
    entity: "rate_grid_cells",
    diff: {
      grid_version: gridVersion,
      carrier,
      destination,
      channel,
      weight_min_g: weightMinG,
      weight_max_g: weightMaxG,
      price,
    },
  });
  revalidatePricing();
  return { ok: true };
}

export async function importRateGridCsvAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error: error ?? "Admin access required." };

  const gridVersion = String(formData.get("grid_version") ?? "").trim();
  const file = formData.get("csv");
  if (!gridVersion) return { ok: false, error: "Choose a grid version." };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a CSV file." };
  }

  const parsed = parseRateGridCsv(await file.text());
  if (parsed.errors.length > 0) {
    return { ok: false, error: parsed.errors.slice(0, 8).join(" ") };
  }

  const admin = createAdminClient();
  const { data: grid } = await admin
    .from("rate_grids")
    .select("grid_version")
    .eq("grid_version", gridVersion)
    .maybeSingle();
  if (!grid) return { ok: false, error: "Rate grid not found." };

  const { error: upsertError } = await admin.from("rate_grid_cells").upsert(
    parsed.rows.map((row) => ({
      grid_version: gridVersion,
      carrier: row.carrier,
      destination: row.destination,
      channel: row.channel,
      weight_min_g: row.weightMinG,
      weight_max_g: row.weightMaxG,
      price: row.price,
      delivery_range: row.deliveryRange,
    })),
    {
      onConflict: "grid_version,carrier,destination,channel,weight_min_g,weight_max_g,line_name",
    },
  );
  if (upsertError) return { ok: false, error: upsertError.message };

  await writeAudit({
    actorUserId: ctx.userId,
    action: "pricing.csv.import",
    entity: "rate_grid_cells",
    diff: { grid_version: gridVersion, rows: parsed.rows.length },
  });
  revalidatePricing();
  return { ok: true, clientId: String(parsed.rows.length) };
}

export async function activateRateGridAction(
  gridVersion: string,
): Promise<ActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error: error ?? "Admin access required." };

  const admin = createAdminClient();
  const { data: grid } = await admin
    .from("rate_grids")
    .select("grid_version")
    .eq("grid_version", gridVersion)
    .maybeSingle();
  if (!grid) return { ok: false, error: "Rate grid not found." };

  const { error: updateError } = await admin.from("pricing_meta").upsert({
    key: "active_grid_version",
    value: gridVersion,
  });
  if (updateError) return { ok: false, error: updateError.message };

  await writeAudit({
    actorUserId: ctx.userId,
    action: "pricing.grid.activate",
    entity: "pricing_meta",
    diff: { active_grid_version: gridVersion },
  });
  revalidatePricing();
  return { ok: true };
}

export async function activateRateGridFormAction(formData: FormData): Promise<void> {
  const gridVersion = String(formData.get("grid_version") ?? "");
  const result = await activateRateGridAction(gridVersion);
  if (!result.ok) throw new Error(result.error ?? "Could not activate rate grid.");
}

export async function updateClientPricingAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error: error ?? "Admin access required." };

  const clientId = String(formData.get("client_id") ?? "");
  if (!clientId) return { ok: false, error: "Missing client." };
  const commissionPct = numberField(formData, "commission_pct");
  const handlingFee = numberField(formData, "handling_fee");
  const logisticsDiscountPct = numberField(formData, "logistics_discount_pct");
  if (
    commissionPct < 0 ||
    handlingFee < 0 ||
    logisticsDiscountPct < 0 ||
    logisticsDiscountPct > 100
  ) {
    return { ok: false, error: "Les valeurs doivent être positives ; remise entre 0 et 100 %." };
  }

  const rawTier = formData.get("pricing_tier");
  const pricingTier = rawTier == null ? null : parsePricingTier(String(rawTier));
  if (rawTier != null && !pricingTier) return { ok: false, error: "Palier inconnu." };

  const admin = createAdminClient();
  const values = {
    commission_pct: commissionPct,
    handling_fee: handlingFee,
    logistics_discount_pct: logisticsDiscountPct,
  };
  let { error: updateError } = await admin
    .from("clients")
    .update(pricingTier ? { ...values, pricing_tier: pricingTier } : values)
    .eq("id", clientId);
  if (updateError && pricingTier && isMissingPricingTierColumn(updateError)) {
    // Migration 00016 not run yet: save the prices, the palier is then inferred from them.
    ({ error: updateError } = await admin.from("clients").update(values).eq("id", clientId));
  }
  if (updateError) return { ok: false, error: updateError.message };

  await writeAudit({
    actorUserId: ctx.userId,
    clientId,
    action: "pricing.client.update",
    entity: "clients",
    diff: {
      pricing_tier: pricingTier,
      commission_pct: commissionPct,
      handling_fee: handlingFee,
      logistics_discount_pct: logisticsDiscountPct,
    },
  });
  revalidatePricing();
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, clientId };
}

// ---------------------------------------------------------------------------
// Pricing settings (margin rule) — pricing_meta.pricing_settings
// ---------------------------------------------------------------------------

export async function savePricingSettingsAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error: error ?? "Admin access required." };

  const settings = parsePricingSettings({
    fx_rmb_per_eur: numberField(formData, "fx_rmb_per_eur", DEFAULT_PRICING_SETTINGS.fx_rmb_per_eur),
    margin_pct: numberField(formData, "margin_pct", DEFAULT_PRICING_SETTINGS.margin_pct),
    min_margin_eur_per_parcel: numberField(
      formData,
      "min_margin_eur_per_parcel",
      DEFAULT_PRICING_SETTINGS.min_margin_eur_per_parcel,
    ),
    eu_parcel_tax_eur: numberField(formData, "eu_parcel_tax_eur", DEFAULT_PRICING_SETTINGS.eu_parcel_tax_eur),
    handling_cost_eur: numberField(formData, "handling_cost_eur", DEFAULT_PRICING_SETTINGS.handling_cost_eur),
    fx_market_rate: numberField(formData, "fx_market_rate", DEFAULT_PRICING_SETTINGS.fx_market_rate),
  });
  const admin = createAdminClient();
  const { error: writeError } = await writePricingSettings(admin, settings);
  if (writeError) return { ok: false, error: writeError };

  await writeAudit({
    actorUserId: ctx.userId,
    action: "pricing.settings.update",
    entity: "pricing_meta",
    diff: { ...settings },
  });
  revalidatePricing();
  revalidatePath("/admin/pricing/update");
  revalidatePath("/admin/margin");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// AI-assisted rate import ("Mettre à jour les tarifs")
// ---------------------------------------------------------------------------

export type RateImportActionResult = {
  ok: boolean;
  error?: string;
  importId?: string;
  review?: RateImportReview;
  gridVersion?: string;
  counts?: { cells: number; lines: number };
};

const MAX_IMPORT_FILES = 3;
const MAX_IMPORT_FILE_BYTES = 8 * 1024 * 1024;

function assistantError(err: unknown): string {
  if (err instanceof AssistantNotConfiguredError) return ASSISTANT_NOT_CONFIGURED;
  if (err instanceof Error) return err.message;
  return "Unexpected assistant error.";
}

/**
 * Step 1: upload / paste → draft import. Two paths:
 * - Voltship matrix (.xlsx, DESTINATION-CATEGORY sheets) → deterministic `parseVoltshipMatrix`
 *   when the "direct import" box is ticked or the sheet names match; multi-carrier draft.
 * - anything else → Claude (`parseCarrierPriceList`).
 */
export async function startRateImportAction(
  _prev: RateImportActionResult | undefined,
  formData: FormData,
): Promise<RateImportActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error: error ?? "Admin access required." };

  const carrier = String(formData.get("carrier") ?? "").trim() || null;
  const hint = String(formData.get("hint") ?? "").trim() || null;
  const text = String(formData.get("text") ?? "").trim() || null;
  const forceMatrix = formData.get("matrix") === "on" || formData.get("matrix") === "true";
  const rawFiles = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (rawFiles.length > MAX_IMPORT_FILES) {
    return { ok: false, error: `At most ${MAX_IMPORT_FILES} files.` };
  }
  if (rawFiles.some((f) => f.size > MAX_IMPORT_FILE_BYTES)) {
    return { ok: false, error: "Each file must be 8 MB or smaller." };
  }
  if (!text && rawFiles.length === 0) {
    return { ok: false, error: "Paste the price list or attach a file." };
  }

  const files: PriceListFile[] = await Promise.all(
    rawFiles.map(async (file) => ({
      name: file.name,
      mime: file.type || guessMime(file.name),
      base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
    })),
  );

  const matrixFile = pickMatrixFile(files, forceMatrix);
  let result: Awaited<ReturnType<typeof parseCarrierPriceList>>;
  if (matrixFile) {
    try {
      const matrix = parseVoltshipMatrix(Buffer.from(matrixFile.base64, "base64"));
      result = {
        parsed: matrix.parsed,
        // Keep the stored trace compact: the raw gram-by-gram brackets of every column weigh
        // ~14 MB of JSON for the full matrix and blow the database statement timeout.
        modelOutput: {
          source: "voltship_matrix",
          sheets: matrix.sheets,
          columns: matrix.columns.map((c) => ({
            sheet: c.sheet,
            column: c.column,
            header: c.header,
            lineIndex: c.lineIndex,
            rawBrackets: c.rawBrackets.length,
          })),
        },
        model: "voltship-matrix",
        inputs: { text: false, files: [{ name: matrixFile.name, mime: matrixFile.mime }] },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Could not read the matrix." };
    }
  } else {
    if (!isAssistantConfigured()) return { ok: false, error: ASSISTANT_NOT_CONFIGURED };
    try {
      result = await parseCarrierPriceList({ carrier, text, files, hint });
    } catch (err) {
      return { ok: false, error: assistantError(err) };
    }
  }
  if (result.parsed.lines.length === 0) {
    return {
      ok: false,
      error: `No usable line found. ${result.parsed.warnings.slice(0, 3).join(" ")}`.trim(),
    };
  }

  const admin = createAdminClient();
  const settings = await readPricingSettings(admin);
  const cells = expandToCells(result.parsed, settings, {});
  const { data: inserted, error: insertError } = await admin
    .from("rate_grid_imports")
    .insert({
      status: "draft",
      carrier: result.parsed.carrier,
      destination_hint: hint,
      raw_text: text,
      model_output_json: result.modelOutput as Record<string, unknown>,
      proposed_cells_json: cells,
      summary_json: {
        parsed: result.parsed,
        overrides: {},
        model: result.model,
        source_files: result.inputs.files,
        summary: summarizeImport(result.parsed, cells, {}),
      },
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (insertError || !inserted) return { ok: false, error: insertError?.message ?? "Could not save the import." };

  await writeAudit({
    actorUserId: ctx.userId,
    action: "pricing.import.start",
    entity: "rate_grid_imports",
    diff: {
      import_id: inserted.id,
      carrier: result.parsed.carrier,
      source: result.model,
      lines: result.parsed.lines.length,
      files: result.inputs.files,
    },
  });
  revalidatePath("/admin/pricing/update");
  return { ok: true, importId: inserted.id };
}

/**
 * The spreadsheet to import directly, or null for the assistant path. Forced by the
 * checkbox, else auto-detected from the sheet names ("FRANCE-STANDARD"…).
 */
function pickMatrixFile(files: PriceListFile[], force: boolean): PriceListFile | null {
  for (const file of files) {
    if (!/\.xlsx$/i.test(file.name) && !isSpreadsheetFile(file.name, file.mime)) continue;
    if (force) return file;
    try {
      if (isVoltshipMatrix(workbookSheetNames(Buffer.from(file.base64, "base64")))) return file;
    } catch {
      // unreadable workbook → let the assistant path report it
    }
  }
  return null;
}

function guessMime(name: string) {
  const ext = name.toLowerCase().split(".").pop();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "csv":
      return "text/csv";
    case "xlsx":
    case "xlsm":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "xls":
      return "application/vnd.ms-excel";
    case "txt":
    case "md":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function sanitizeOverrides(raw: unknown): ImportOverrides {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const lines: NonNullable<ImportOverrides["lines"]> = {};
  if (source.lines && typeof source.lines === "object") {
    for (const [key, value] of Object.entries(source.lines as Record<string, unknown>)) {
      if (!/^\d+$/.test(key) || !value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      const entry: LineOverride = {};
      if (typeof v.include === "boolean") entry.include = v.include;
      if (typeof v.tax_included === "boolean") entry.tax_included = v.tax_included;
      lines[key] = entry;
    }
  }
  const settings =
    source.settings && typeof source.settings === "object"
      ? (source.settings as Record<string, unknown>)
      : null;
  const cleanSettings: Partial<PricingSettings> = {};
  if (settings) {
    for (const key of [
      "fx_rmb_per_eur",
      "margin_pct",
      "min_margin_eur_per_parcel",
      "eu_parcel_tax_eur",
      "handling_cost_eur",
      "fx_market_rate",
    ] as const) {
      const value = Number(settings[key]);
      if (Number.isFinite(value)) cleanSettings[key] = value;
    }
  }
  return { lines, ...(Object.keys(cleanSettings).length > 0 ? { settings: cleanSettings } : {}) };
}

/** Step 2: admin toggles → recompute cells + comparison and persist them on the draft. */
export async function reviewRateImportAction(
  importId: string,
  overridesInput: ImportOverrides,
): Promise<RateImportActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error: error ?? "Admin access required." };

  const row = await getRateImport(importId);
  if (!row) return { ok: false, error: "Import not found." };
  if (row.status === "activated" || row.status === "discarded") {
    const review = await buildRateImportReview(row, readOverrides(row.summary_json));
    return { ok: true, importId, review };
  }

  const overrides = sanitizeOverrides(overridesInput);
  const review = await buildRateImportReview(row, overrides);
  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("rate_grid_imports")
    .update({
      status: "reviewed",
      proposed_cells_json: review.cells,
      summary_json: {
        ...(row.summary_json ?? {}),
        overrides,
        settings: review.settings,
        summary: review.summary,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", importId);
  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true, importId, review: { ...review, status: "reviewed" } };
}

/** Step 3: write the versioned grid, activate it, close the import. */
export async function activateRateImportAction(
  importId: string,
  options: { gridVersion?: string | null; confirmLowConfidence?: boolean } = {},
): Promise<RateImportActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error: error ?? "Admin access required." };

  const row = await getRateImport(importId);
  if (!row) return { ok: false, error: "Import not found." };
  if (row.status === "activated") return { ok: false, error: "This import is already activated." };
  if (row.status === "discarded") return { ok: false, error: "This import was discarded." };

  const overrides = readOverrides(row.summary_json);
  const review = await buildRateImportReview(row, overrides);
  if (review.cells.length === 0) return { ok: false, error: "No cell to activate — include at least one line." };
  if (review.lowConfidence && !options.confirmLowConfidence) {
    return { ok: false, error: "Some lines have a confidence below 0.5 — confirm to activate anyway." };
  }

  const admin = createAdminClient();
  const { count } = await admin.from("rate_grids").select("grid_version", { count: "exact", head: true });
  let gridVersion = String(options.gridVersion ?? "").trim();
  if (!gridVersion) gridVersion = buildGridVersion((count ?? 0) + 1, review.carrier);
  const { data: existing } = await admin
    .from("rate_grids")
    .select("grid_version")
    .eq("grid_version", gridVersion)
    .maybeSingle();
  if (existing) return { ok: false, error: `Grid version ${gridVersion} already exists.` };

  const effectiveDate = review.parsed.grid_date ?? new Date().toISOString().slice(0, 10);
  const { error: gridError } = await admin.from("rate_grids").insert({
    grid_version: gridVersion,
    effective_date: effectiveDate,
    source: review.model === "voltship-matrix" ? "matrix_import" : "ai_import",
    notes: [review.hint, ...review.parsed.warnings].filter(Boolean).join("\n") || null,
    source_files: review.sourceFiles,
    settings_json: { ...review.settings, import_id: importId, model: review.model },
  });
  if (gridError) return { ok: false, error: gridError.message };

  // Carry forward every other carrier of the active grid; replace the imported carrier.
  const activeRecords = await loadGridCellRecords(review.activeGridVersion);
  const merged = mergeGridCells(activeRecords, proposedToRecords(review.cells), review.carriers);
  const rows = merged.map((cell) => ({
    grid_version: gridVersion,
    carrier: cell.carrier,
    destination: cell.destination,
    channel: cell.channel,
    weight_min_g: cell.weightMinG,
    weight_max_g: cell.weightMaxG,
    price: cell.price,
    delivery_range: cell.deliveryRange,
    line_name: cell.lineName ?? "",
    tax_included: cell.taxIncluded,
    notes: cell.notes,
    carrier_cost_rmb: cell.carrierCostRmb,
    ioss_required: cell.iossRequired,
  }));
  const importedCount = review.cells.length;
  for (let index = 0; index < rows.length; index += 500) {
    const { error: cellError } = await admin.from("rate_grid_cells").upsert(rows.slice(index, index + 500), {
      onConflict: "grid_version,carrier,destination,channel,weight_min_g,weight_max_g,line_name",
    });
    if (cellError) {
      await admin.from("rate_grids").delete().eq("grid_version", gridVersion);
      return { ok: false, error: cellError.message };
    }
  }

  const { error: metaError } = await admin
    .from("pricing_meta")
    .upsert({ key: "active_grid_version", value: gridVersion });
  if (metaError) return { ok: false, error: metaError.message };

  await admin
    .from("rate_grid_imports")
    .update({ status: "activated", grid_version: gridVersion, updated_at: new Date().toISOString() })
    .eq("id", importId);

  await writeAudit({
    actorUserId: ctx.userId,
    action: "pricing.grid_activated",
    entity: "rate_grids",
    diff: {
      grid_version: gridVersion,
      previous_grid_version: review.activeGridVersion,
      import_id: importId,
      carrier: review.carrier,
      carriers: review.carriers,
      cells: rows.length,
      imported_cells: importedCount,
      carried_forward_cells: rows.length - importedCount,
      lines: review.summary.includedLines,
      settings: review.settings,
      low_confidence_confirmed: review.lowConfidence,
    },
  });
  // Client carrier choices pointing at a line missing from the new grid → tenant notification.
  await notifyUnavailableCarrierLines(gridVersion);
  revalidatePricing();
  revalidatePath("/admin/pricing/update");
  return {
    ok: true,
    importId,
    gridVersion,
    counts: { cells: rows.length, lines: review.summary.includedLines },
  };
}

export async function discardRateImportAction(importId: string): Promise<RateImportActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error: error ?? "Admin access required." };
  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("rate_grid_imports")
    .update({ status: "discarded", updated_at: new Date().toISOString() })
    .eq("id", importId)
    .neq("status", "activated");
  if (updateError) return { ok: false, error: updateError.message };
  revalidatePath("/admin/pricing/update");
  return { ok: true, importId };
}
