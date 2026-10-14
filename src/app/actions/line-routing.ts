"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/auth/audit";
import { getAuthContext } from "@/lib/auth/context";
import { parseZipList, type ZipCoverageMode } from "@/lib/domain/line-routing";
import { normalizeDestination } from "@/lib/domain/pricing";
import { isEccangConfigured } from "@/lib/eccang/client";
import {
  checkOrderLines,
  deleteZipCoverage,
  loadRoutingContext,
  saveZipCoverage,
} from "@/lib/eccang/line-routing-server";
import { listEccangEnabledClientIds } from "@/lib/eccang/sync";

export type LineRoutingErrorCode = "admin" | "pick_line" | "file_too_large" | "no_zip" | "too_many" | "not_configured";

export type LineRoutingActionResult = {
  ok: boolean;
  /** Known problem (translated by the form) — `error` carries any other message. */
  code?: LineRoutingErrorCode;
  error?: string;
  /** Codes saved for the line. */
  saved?: number;
  /** Entries that are not postcodes (shown so the admin can fix the file). */
  invalid?: string[];
  summary?: { checked: number; moreExpensive: number; extraRmb: number; rerouted: number };
};

/** Largest postcode list accepted in one import (the whole US ≈ 42 000 ZIPs). */
const MAX_ZIPS = 60_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

async function requireAdmin() {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "voltship_admin") return null;
  return ctx;
}

function revalidate() {
  revalidatePath("/admin/lines");
  revalidatePath("/[locale]/admin/lines", "page");
}

/**
 * Saves the postcode list of one line ("US||YunExpress||商派特惠带电 YTSPTHDD"), pasted in
 * the text area and/or uploaded as a .csv / .txt file. Replaces the previous list.
 */
export async function saveZipCoverageAction(
  _prev: LineRoutingActionResult | undefined,
  formData: FormData,
): Promise<LineRoutingActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, code: "admin" };

  const [destinationRaw, carrier, lineName] = String(formData.get("line") ?? "").split("||");
  const destination = normalizeDestination(destinationRaw ?? "", "");
  if (!destination || !carrier?.trim()) return { ok: false, code: "pick_line" };
  const mode: ZipCoverageMode = formData.get("mode") === "except" ? "except" : "only";

  let text = String(formData.get("zips") ?? "");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { ok: false, code: "file_too_large" };
    text += `\n${await file.text()}`;
  }
  const { zips, invalid } = parseZipList(destination, text);
  if (zips.length === 0) return { ok: false, code: "no_zip", invalid: invalid.slice(0, 20) };
  if (zips.length > MAX_ZIPS) return { ok: false, code: "too_many", saved: zips.length };

  try {
    await saveZipCoverage({
      destination,
      carrier: carrier.trim(),
      lineName: lineName?.trim() || null,
      mode,
      zips,
      note: String(formData.get("note") ?? ""),
      userId: ctx.userId,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save." };
  }
  await writeAudit({
    actorUserId: ctx.userId,
    action: "pricing.zip_coverage.save",
    entity: "carrier_zip_coverage",
    diff: { destination, carrier, lineName: lineName || null, mode, count: zips.length, invalid: invalid.length },
  }).catch(() => null);
  revalidate();
  return { ok: true, saved: zips.length, invalid: invalid.slice(0, 20) };
}

export async function deleteZipCoverageAction(formData: FormData) {
  const ctx = await requireAdmin();
  if (!ctx) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  await deleteZipCoverage(id);
  await writeAudit({
    actorUserId: ctx.userId,
    action: "pricing.zip_coverage.delete",
    entity: "carrier_zip_coverage",
    diff: { id },
  }).catch(() => null);
  revalidate();
}

/**
 * Re-checks the last 7 days of every ECCANG client now, including orders already checked
 * (after a postcode list or the method map changed). The cron checks new changes every 15 min.
 */
export async function runLineCheckAction(): Promise<LineRoutingActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, code: "admin" };
  if (!isEccangConfigured()) return { ok: false, code: "not_configured" };
  try {
    const context = await loadRoutingContext();
    const summary = { checked: 0, moreExpensive: 0, extraRmb: 0, rerouted: 0 };
    for (const clientId of await listEccangEnabledClientIds()) {
      const result = await checkOrderLines(clientId, { days: 7, context, force: true });
      summary.checked += result.checked;
      summary.moreExpensive += result.moreExpensive;
      summary.extraRmb += result.extraRmb;
      summary.rerouted += result.rerouted;
    }
    summary.extraRmb = Math.round(summary.extraRmb * 100) / 100;
    revalidate();
    return { ok: true, summary };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Check failed." };
  }
}
