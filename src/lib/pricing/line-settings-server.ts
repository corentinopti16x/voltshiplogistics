/**
 * Read / write of `carrier_line_settings` (service role). Every reader tolerates the table
 * missing (migration 00025 not applied yet): the app then behaves as before, all lines active.
 */

import {
  cleanSettingText,
  pendingLineKeys,
  type LineSetting,
  type LineStatus,
} from "@/lib/domain/line-settings";
import { createAdminClient } from "@/lib/supabase/admin";

type Row = {
  destination: string;
  carrier: string;
  line_name: string | null;
  status: string;
  eccang_method: string | null;
  delivery_days: string | null;
  note: string | null;
  updated_at: string | null;
};

function isMissingTable(error: { code?: string; message?: string } | null) {
  return (
    !!error &&
    (error.code === "42P01" ||
      error.code === "PGRST205" ||
      /relation "[^"]+" does not exist|could not find the table/i.test(
        error.message ?? "",
      ))
  );
}

function toSetting(row: Row): LineSetting {
  return {
    destination: row.destination.trim().toUpperCase(),
    carrier: row.carrier,
    lineName: row.line_name || null,
    status: row.status === "pending" ? "pending" : "active",
    eccangMethod: row.eccang_method || null,
    deliveryDays: row.delivery_days || null,
    note: row.note || null,
    updatedAt: row.updated_at,
  };
}

/** Every line setting. `ready: false` = the table does not exist yet. */
export async function loadLineSettings(): Promise<{
  ready: boolean;
  settings: LineSetting[];
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("carrier_line_settings")
    .select(
      "destination, carrier, line_name, status, eccang_method, delivery_days, note, updated_at",
    )
    .limit(5000);
  if (isMissingTable(error)) return { ready: false, settings: [] };
  if (error) throw error;
  return { ready: true, settings: ((data ?? []) as Row[]).map(toSetting) };
}

/** Lines the pricing engine must ignore. Never throws: a read problem means « none ». */
export async function loadPendingLineKeys(): Promise<Set<string>> {
  try {
    const { settings } = await loadLineSettings();
    return pendingLineKeys(settings);
  } catch {
    return new Set();
  }
}

export type LineSettingPatch = {
  status?: LineStatus;
  eccangMethod?: string | null;
  deliveryDays?: string | null;
  note?: string | null;
};

export type SaveLineSettingResult =
  | { ok: true; setting: LineSetting; before: LineSetting | null }
  | { ok: false; code: "missing_table" | "invalid" | "failed" };

/** Creates or updates the setting of one line in one country with the given fields only. */
export async function saveLineSetting(
  line: { destination: string; carrier: string; lineName: string | null },
  patch: LineSettingPatch,
  userId: string,
): Promise<SaveLineSettingResult> {
  const destination = line.destination.trim().toUpperCase();
  const carrier = line.carrier.trim();
  const lineName = (line.lineName ?? "").trim();
  if (!/^[A-Z]{2}$/.test(destination) || !carrier)
    return { ok: false, code: "invalid" };

  const values: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    if (patch.status !== "active" && patch.status !== "pending")
      return { ok: false, code: "invalid" };
    values.status = patch.status;
  }
  for (const [field, column] of [
    ["eccangMethod", "eccang_method"],
    ["deliveryDays", "delivery_days"],
    ["note", "note"],
  ] as const) {
    if (patch[field] === undefined) continue;
    const cleaned = cleanSettingText(patch[field]);
    if (!cleaned.ok) return { ok: false, code: "invalid" };
    values[column] = cleaned.value;
  }
  if (Object.keys(values).length === 0) return { ok: false, code: "invalid" };

  const admin = createAdminClient();
  const columns =
    "destination, carrier, line_name, status, eccang_method, delivery_days, note, updated_at";
  const existing = await admin
    .from("carrier_line_settings")
    .select(columns)
    .eq("destination", destination)
    .eq("carrier", carrier)
    .eq("line_name", lineName)
    .maybeSingle();
  if (isMissingTable(existing.error))
    return { ok: false, code: "missing_table" };
  if (existing.error) return { ok: false, code: "failed" };

  const { data, error } = await admin
    .from("carrier_line_settings")
    .upsert(
      {
        destination,
        carrier,
        line_name: lineName,
        ...values,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "destination,carrier,line_name" },
    )
    .select(columns)
    .single();
  if (error || !data) return { ok: false, code: "failed" };
  return {
    ok: true,
    setting: toSetting(data as Row),
    before: existing.data ? toSetting(existing.data as Row) : null,
  };
}
