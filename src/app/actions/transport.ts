"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/auth/audit";
import { getAuthContext } from "@/lib/auth/context";
import type { LineSetting, LineStatus } from "@/lib/domain/line-settings";
import {
  saveLineSetting,
  type LineSettingPatch,
} from "@/lib/pricing/line-settings-server";

export type TransportActionResult =
  | { ok: true; setting: LineSetting }
  | { ok: false; code: "forbidden" | "missing_table" | "invalid" | "failed" };

/**
 * Saves one field of a line's configuration for one country (status, ECCANG method,
 * delivery time, note). Voltship team only (sourcer + admin). Applied immediately:
 * a line set to « pending » stops being picked by the COGS engine on the next page load.
 */
export async function saveLineSettingAction(input: {
  destination: string;
  carrier: string;
  lineName: string | null;
  field: "status" | "eccangMethod" | "deliveryDays" | "note";
  value: string | null;
}): Promise<TransportActionResult> {
  const ctx = await getAuthContext();
  if (!ctx || (ctx.role !== "sourcer" && ctx.role !== "voltship_admin"))
    return { ok: false, code: "forbidden" };

  const patch: LineSettingPatch =
    input.field === "status"
      ? { status: input.value as LineStatus }
      : { [input.field]: input.value };
  const result = await saveLineSetting(
    {
      destination: input.destination,
      carrier: input.carrier,
      lineName: input.lineName,
    },
    patch,
    ctx.userId,
  );
  if (!result.ok) return result;

  await writeAudit({
    actorUserId: ctx.userId,
    action: "transport.line_setting",
    entity: "carrier_line_settings",
    diff: {
      line: `${result.setting.destination}|${result.setting.carrier}|${result.setting.lineName ?? ""}`,
      field: input.field,
      from: result.before ? result.before[input.field] : null,
      to: result.setting[input.field],
    },
  });
  // The status changes which line every product ships on: refresh the pages that show it.
  revalidatePath("/[locale]/sourcer/transport", "page");
  if (input.field === "status") revalidatePath("/[locale]", "layout");
  return { ok: true, setting: result.setting };
}
