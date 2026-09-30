"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/auth/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/app/actions/admin";
import type { ShippingChannel } from "@/lib/domain/pricing";
import { parseRateGridCsv } from "@/lib/domain/rate-grid-csv";

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
        "grid_version,carrier,destination,channel,weight_min_g,weight_max_g",
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
      onConflict: "grid_version,carrier,destination,channel,weight_min_g,weight_max_g",
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
    return { ok: false, error: "Pricing values must be positive; discount is 0–100%." };
  }

  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("clients")
    .update({
      commission_pct: commissionPct,
      handling_fee: handlingFee,
      logistics_discount_pct: logisticsDiscountPct,
    })
    .eq("id", clientId);
  if (updateError) return { ok: false, error: updateError.message };

  await writeAudit({
    actorUserId: ctx.userId,
    clientId,
    action: "pricing.client.update",
    entity: "clients",
    diff: {
      commission_pct: commissionPct,
      handling_fee: handlingFee,
      logistics_discount_pct: logisticsDiscountPct,
    },
  });
  revalidatePricing();
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, clientId };
}
