"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/auth/audit";
import { getAuthContext } from "@/lib/auth/context";
import type { LineSetting, LineStatus } from "@/lib/domain/line-settings";
import type { ShippingChannel } from "@/lib/domain/pricing";
import {
  applyLinePrice,
  previewLinePrice,
  type LinePriceFailure,
  type LinePricePreview,
} from "@/lib/pricing/line-price-server";
import {
  saveLineSetting,
  type LineSettingPatch,
} from "@/lib/pricing/line-settings-server";
import { TRANSPORT_SAMPLE_WEIGHTS_G } from "@/lib/pricing/transport-view";

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

async function teamContext() {
  const ctx = await getAuthContext();
  if (!ctx || (ctx.role !== "sourcer" && ctx.role !== "voltship_admin"))
    return null;
  return ctx;
}

export type LinePriceInput = {
  destination: string;
  channel: ShippingChannel;
  carrier: string;
  lineName: string | null;
  /** True when the line does not exist yet for this country and product type. */
  isNew: boolean;
  price: { tiers: unknown; minBillableG: unknown };
};

/** What a new price changes, before it is saved. Writes nothing. */
export async function previewLinePriceAction(
  input: LinePriceInput,
): Promise<
  | { ok: true; preview: LinePricePreview }
  | { ok: false; code: LinePriceFailure | "forbidden" }
> {
  if (!(await teamContext())) return { ok: false, code: "forbidden" };
  const result = await previewLinePrice(input, input.price, input.isNew).catch(
    () => ({ ok: false as const, error: "failed" as const }),
  );
  return result.ok ? result : { ok: false, code: result.error };
}

/**
 * Saves the price of one line for one country and product type in the active grid.
 * Applied immediately: every COGS is recalculated from it on the next page load.
 */
export async function saveLinePriceAction(
  input: LinePriceInput,
): Promise<{ ok: true } | { ok: false; code: LinePriceFailure | "forbidden" }> {
  const ctx = await teamContext();
  if (!ctx) return { ok: false, code: "forbidden" };
  const result = await applyLinePrice(
    input,
    input.price,
    input.isNew,
    ctx.userId,
  ).catch(() => ({ ok: false as const, error: "failed" as const }));
  if (!result.ok) return { ok: false, code: result.error };

  await writeAudit({
    actorUserId: ctx.userId,
    action: input.isNew ? "transport.line_added" : "transport.line_price",
    entity: "rate_grid_cells",
    diff: {
      grid_version: result.gridVersion,
      line: `${result.target.destination}|${result.target.channel}|${result.target.carrier}|${result.target.lineName ?? ""}`,
      tiers: result.price.tiers,
      min_billable_g: result.price.minBillableG,
      sample_weights_g: [...TRANSPORT_SAMPLE_WEIGHTS_G],
      cost_rmb_before: result.before,
      cost_rmb_after: result.after,
      cells: result.cells,
    },
  });
  // Every product page, catalogue and margin view reads the grid.
  revalidatePath("/[locale]", "layout");
  return { ok: true };
}
