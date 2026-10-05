"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/auth/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/app/actions/admin";
import { invalidateFinanceSnapshots } from "@/lib/finance/weekly";
import {
  FIXED_COST_CATEGORIES,
  FIXED_COST_PERIODS,
  isValidDateString,
  weekStartOfDate,
  type FixedCostCategory,
  type FixedCostPeriod,
} from "@/lib/finance/weeks";

// Confidential: voltship_admin only, never while impersonating a client.
async function requireAdmin() {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "voltship_admin" || ctx.impersonating) {
    return { ctx: null, error: "Admin access required." };
  }
  return { ctx, error: null };
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function amount(formData: FormData, key: string) {
  const raw = text(formData, key).replace(/\s/g, "").replace(",", ".");
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN;
}

function revalidateFinance() {
  revalidatePath("/admin");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/finance/costs");
  revalidatePath("/[locale]/admin/finance", "page");
  revalidatePath("/[locale]/admin/finance/costs", "page");
}

export async function createFixedCostAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error };

  const label = text(formData, "label");
  const amountEur = amount(formData, "amount_eur");
  const period = text(formData, "period") as FixedCostPeriod;
  const category = text(formData, "category") as FixedCostCategory;
  const startDate = text(formData, "start_date");
  const endDate = text(formData, "end_date");
  const notes = text(formData, "notes");

  if (label.length < 2) return { ok: false, error: "Label is required." };
  if (!Number.isFinite(amountEur) || amountEur < 0) return { ok: false, error: "Amount must be a positive number." };
  if (!FIXED_COST_PERIODS.includes(period)) return { ok: false, error: "Invalid period." };
  if (!FIXED_COST_CATEGORIES.includes(category)) return { ok: false, error: "Invalid category." };
  if (!isValidDateString(startDate)) return { ok: false, error: "Start date is required." };
  if (endDate && (!isValidDateString(endDate) || endDate < startDate)) {
    return { ok: false, error: "End date must be after the start date." };
  }

  const admin = createAdminClient();
  const { data, error: insertError } = await admin
    .from("fixed_costs")
    .insert({
      label,
      amount_eur: amountEur,
      period,
      category,
      start_date: startDate,
      end_date: endDate || null,
      notes: notes || null,
    })
    .select("id")
    .single();
  if (insertError) return { ok: false, error: insertError.message };

  await writeAudit({
    actorUserId: ctx.userId,
    action: "finance.fixed_cost.create",
    entity: "fixed_costs",
    diff: { id: data.id, label, amount_eur: amountEur, period, category, start_date: startDate, end_date: endDate || null },
  });
  await invalidateFinanceSnapshots();
  revalidateFinance();
  return { ok: true };
}

export async function deleteFixedCostAction(formData: FormData): Promise<void> {
  const { ctx } = await requireAdmin();
  if (!ctx) throw new Error("Admin access required.");
  const id = text(formData, "id");
  if (!id) throw new Error("Missing id.");
  const admin = createAdminClient();
  const { error } = await admin.from("fixed_costs").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await writeAudit({ actorUserId: ctx.userId, action: "finance.fixed_cost.delete", entity: "fixed_costs", diff: { id } });
  await invalidateFinanceSnapshots();
  revalidateFinance();
}

export async function createAdjustmentAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error };

  const label = text(formData, "label");
  const amountEur = amount(formData, "amount_eur");
  const kind = text(formData, "kind");
  const date = text(formData, "week_date");
  const notes = text(formData, "notes");

  if (label.length < 2) return { ok: false, error: "Label is required." };
  if (!Number.isFinite(amountEur) || amountEur === 0) return { ok: false, error: "Amount must be a non-zero number." };
  if (kind !== "revenue" && kind !== "cost") return { ok: false, error: "Invalid kind." };
  if (!isValidDateString(date)) return { ok: false, error: "A date in the week is required." };
  const weekStart = weekStartOfDate(date);

  const admin = createAdminClient();
  const { data, error: insertError } = await admin
    .from("finance_adjustments")
    .insert({ week_start: weekStart, label, amount_eur: amountEur, kind, notes: notes || null })
    .select("id")
    .single();
  if (insertError) return { ok: false, error: insertError.message };

  await writeAudit({
    actorUserId: ctx.userId,
    action: "finance.adjustment.create",
    entity: "finance_adjustments",
    diff: { id: data.id, week_start: weekStart, label, amount_eur: amountEur, kind },
  });
  await invalidateFinanceSnapshots();
  revalidateFinance();
  return { ok: true };
}

export async function deleteAdjustmentAction(formData: FormData): Promise<void> {
  const { ctx } = await requireAdmin();
  if (!ctx) throw new Error("Admin access required.");
  const id = text(formData, "id");
  if (!id) throw new Error("Missing id.");
  const admin = createAdminClient();
  const { error } = await admin.from("finance_adjustments").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await writeAudit({
    actorUserId: ctx.userId,
    action: "finance.adjustment.delete",
    entity: "finance_adjustments",
    diff: { id },
  });
  await invalidateFinanceSnapshots();
  revalidateFinance();
}
