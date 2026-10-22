"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { quickSaveSourcingAction, type SourcingActionResult } from "@/app/actions/sourcing";
import type { SourcingStatus } from "@/lib/products/types";
import type { ShippingChannel } from "@/lib/domain/pricing";

const initial: SourcingActionResult = { ok: false };
const channels: ShippingChannel[] = ["standard", "electronics_battery", "cosmetics", "magnetic", "sensitive_other"];
const statuses: SourcingStatus[] = [
  "brief_received",
  "factories",
  "samples",
  "negotiation",
  "quote_sent",
  "validated",
  "in_production",
  "in_stock",
  "flagged",
];

/**
 * One catalog row in « saisie rapide »: factory price (¥) → client price (€) computed,
 * weight, channel, status, saved in one click without opening the product sheet.
 */
export function QuickEditRow({
  productId,
  factoryRmb,
  clientPrice,
  weightG,
  channel,
  status,
  fxRmbPerEur,
}: {
  productId: string;
  factoryRmb: number | null;
  clientPrice: number | null;
  weightG: number | null;
  channel: string | null;
  status: string | null;
  fxRmbPerEur: number;
}) {
  const t = useTranslations("sourcer.quick");
  const tForm = useTranslations("sourcer.form");
  const tQueue = useTranslations("sourcer.queue");
  const [factory, setFactory] = useState(factoryRmb != null ? String(factoryRmb) : "");
  const [state, action, pending] = useActionState(quickSaveSourcingAction, initial);
  const factoryNumber = Number(factory.replace(",", "."));
  const eur =
    factory.trim() && Number.isFinite(factoryNumber) && factoryNumber > 0 && fxRmbPerEur > 0
      ? Math.round((factoryNumber / fxRmbPerEur) * 100) / 100
      : null;
  const field = "rounded-md border border-[var(--line)] bg-white px-2 py-1 text-xs";

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="fx_rmb_per_eur" value={String(fxRmbPerEur)} />
      <label className="flex flex-col gap-0.5 text-[11px] text-[var(--muted)]">
        {t("factory")}
        <input
          name="factory_purchase_price"
          inputMode="decimal"
          value={factory}
          onChange={(event) => setFactory(event.target.value)}
          className={`${field} w-20`}
          placeholder="¥"
        />
      </label>
      <span className="pb-1 text-[11px] text-[var(--muted)] tabular-nums">
        {eur != null ? `= ${eur.toFixed(2).replace(".", ",")} €` : clientPrice != null ? `${clientPrice} €` : "— €"}
      </span>
      <label className="flex flex-col gap-0.5 text-[11px] text-[var(--muted)]">
        {t("weight")}
        <input
          name="weight_g"
          inputMode="numeric"
          defaultValue={weightG ?? ""}
          className={`${field} w-16`}
          placeholder="g"
        />
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-[var(--muted)]">
        {t("channel")}
        <select name="shipping_channel" defaultValue={channel ?? ""} className={field}>
          <option value="">{tForm("select")}</option>
          {channels.map((value) => (
            <option key={value} value={value}>
              {tForm(`channels.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-[var(--muted)]">
        {t("status")}
        <select name="sourcing_status" defaultValue={status ?? "brief_received"} className={field}>
          {statuses.map((value) => (
            <option key={value} value={value}>
              {tQueue(`statuses.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="cursor-pointer rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
      >
        {pending ? t("saving") : t("save")}
      </button>
      {state.ok ? <span className="pb-1 text-[11px] text-emerald-800">{t("saved")}</span> : null}
      {state.error ? (
        <span className="pb-1 text-[11px] text-red-700" role="alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
