"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import {
  flagSourcingAction,
  saveSourcingDraftAction,
  sendQuoteAction,
  type SourcingActionResult,
} from "@/app/actions/sourcing";
import { getProductRequest, type ProductRow, type SourcingStatus } from "@/lib/products/types";
import type { ShippingChannel } from "@/lib/domain/pricing";
import { isShippingChannel, parseProductAttributes, tickedAttributes } from "@/lib/products/attributes";

const initial: SourcingActionResult = { ok: false };
const channels: ShippingChannel[] = [
  "standard",
  "electronics_battery",
  "cosmetics",
  "liquid_perfume",
  "magnetic",
  "sensitive_other",
];
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

type WorkRow = {
  factory_purchase_price: number | null;
  supplier_name: string | null;
  supplier_contact: string | null;
  sourcing_location: string | null;
  internal_notes: string | null;
  flagged_reason: string | null;
} | null;

export function SourcingWorkForm({
  product,
  work,
  fxRmbPerEur,
}: {
  product: ProductRow;
  work: WorkRow;
  /** Pricing settings rate (RMB per €), used to show the factory price in €. */
  fxRmbPerEur: number;
}) {
  const router = useRouter();
  const t = useTranslations("sourcer.form");
  const tQueue = useTranslations("sourcer.queue");
  // Channel / attribute labels live in messages (sourcer.form.channels / .attributes).
  const attributeLabel = (key: string) =>
    t.has(`attributes.${key}`) ? t(`attributes.${key}`) : key;
  const [factoryRmb, setFactoryRmb] = useState<string>(
    work?.factory_purchase_price != null ? String(work.factory_purchase_price) : "",
  );
  const [clientPrice, setClientPrice] = useState<string>(
    product.client_price != null ? String(product.client_price) : "",
  );
  const factoryEur =
    factoryRmb.trim() && Number.isFinite(Number(factoryRmb)) && fxRmbPerEur > 0
      ? Math.round((Number(factoryRmb) / fxRmbPerEur) * 100) / 100
      : null;
  const [saveState, saveAction, saving] = useActionState(saveSourcingDraftAction, initial);
  const [sendState, sendAction, sending] = useActionState(sendQuoteAction, initial);
  const [flagState, flagAction, flagging] = useActionState(flagSourcingAction, initial);
  // Client's answers → suggested channel. Pre-fills the select only when the sourcer
  // has not stored a channel yet; the sourcer's value always wins once saved.
  const request = getProductRequest(product);
  const suggested = isShippingChannel(request.suggested_channel) ? request.suggested_channel : null;
  const ticked = tickedAttributes(parseProductAttributes(request.attributes));

  useEffect(() => {
    if (sendState.ok && sendState.nextId) {
      router.push(`/sourcer/${sendState.nextId}`);
    }
  }, [router, sendState]);

  return (
    <div className="space-y-6">
      <form action={saveAction} className="space-y-6">
        <input type="hidden" name="product_id" value={product.id} />
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <h2 className="text-sm font-semibold">{t("clientFieldsTitle")}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {t("clientFieldsIntro")}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              name="client_price"
              label={t("clientPrice")}
              unit="€ EUR"
              hint={t("clientPriceHint")}
              type="number"
              min="0"
              step="0.0001"
              value={clientPrice}
              onChange={(event) => setClientPrice(event.target.value)}
            />
            <Input
              name="weight_g"
              label={t("unitWeight")}
              unit={t("gramsUnit")}
              type="number"
              min="1"
              defaultValue={product.weight_g ?? ""}
            />
            <Input
              name="sku"
              label={t("sku")}
              hint={t("skuHint")}
              defaultValue={product.sku ?? ""}
              maxLength={80}
            />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[var(--muted)]">{t("shippingChannel")}</span>
              <select
                name="shipping_channel"
                defaultValue={product.shipping_channel ?? suggested ?? ""}
                className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
              >
                <option value="">{t("select")}</option>
                {channels.map((channel) => (
                  <option key={channel} value={channel}>
                    {t(`channels.${channel}`)}
                  </option>
                ))}
              </select>
              {suggested ? (
                <span className="text-xs text-[var(--muted)]">
                  {t.rich("suggestedByClient", {
                    channel: t(`channels.${suggested}`),
                    strong: (chunks) => <strong>{chunks}</strong>,
                  })}
                  {ticked.length > 0
                    ? t("tickedList", {
                        list: ticked.map((key) => attributeLabel(key)).join(t("listSeparator")),
                      })
                    : t("nothingTicked")}
                  {product.shipping_channel && product.shipping_channel !== suggested
                    ? t("yourValueWins")
                    : t("confirmOrCorrect")}
                </span>
              ) : null}
            </label>
            <label className="flex items-start gap-2 self-end text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                name="battery_internal"
                defaultChecked={product.quote_json?.battery_internal === true}
                className="mt-0.5"
              />
              <span>{t("batteryInternal")}</span>
            </label>
            <Input
              name="production_lead_days"
              label={t("productionLead")}
              unit={t("daysUnit")}
              type="number"
              min="0"
              defaultValue={product.production_lead_days ?? ""}
            />
            <Input
              name="moq"
              label={t("moq")}
              unit={t("unitsUnit")}
              type="number"
              min="0"
              defaultValue={product.moq ?? ""}
            />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[var(--muted)]">{t("sourcingStatus")}</span>
              <select
                name="sourcing_status"
                defaultValue={product.sourcing_status ?? "brief_received"}
                className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
              >
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {tQueue(`statuses.${status}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-sm font-semibold text-amber-950">{t("internalTitle")}</h2>
          <p className="mt-1 text-xs text-amber-900">
            {t("internalIntro")}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Input
                name="factory_purchase_price"
                label={t("factoryPrice")}
                unit="¥ RMB"
                type="number"
                min="0"
                step="0.0001"
                value={factoryRmb}
                onChange={(event) => setFactoryRmb(event.target.value)}
              />
              {factoryEur != null ? (
                <p className="text-xs text-amber-900">
                  {t("fxConversion", { eur: factoryEur.toFixed(2), rate: String(fxRmbPerEur) })}
                  {String(factoryEur) !== clientPrice ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        onClick={() => setClientPrice(String(factoryEur))}
                        className="cursor-pointer font-semibold underline"
                      >
                        {t("useAsClientPrice")}
                      </button>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            <Input
              name="sourcing_location"
              label={t("sourcingLocation")}
              defaultValue={work?.sourcing_location ?? ""}
            />
            <Input
              name="supplier_name"
              label={t("supplierName")}
              defaultValue={work?.supplier_name ?? ""}
            />
            <Input
              name="supplier_contact"
              label={t("supplierContact")}
              defaultValue={work?.supplier_contact ?? ""}
            />
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-amber-900">{t("internalNotes")}</span>
              <textarea
                name="internal_notes"
                rows={4}
                defaultValue={work?.internal_notes ?? ""}
                className="rounded-md border border-amber-300 bg-white px-3 py-2"
              />
            </label>
          </div>
        </section>

        {saveState.error || sendState.error ? (
          <p className="text-sm text-red-700" role="alert">
            {saveState.error ?? sendState.error}
          </p>
        ) : null}
        {saveState.ok ? <p className="text-sm text-emerald-800">{t("draftSaved")}</p> : null}
        {sendState.ok ? <p className="text-sm text-emerald-800">{t("quoteSent")}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving || sending}
            className="cursor-pointer rounded-md border border-[var(--line)] px-4 py-2 text-sm hover:bg-white disabled:opacity-60"
          >
            {saving ? t("saving") : t("saveDraft")}
          </button>
          <button
            type="submit"
            formAction={sendAction}
            disabled={saving || sending}
            className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {sending ? t("sending") : t("sendQuote")}
          </button>
        </div>
      </form>

      <form action={flagAction} className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <input type="hidden" name="product_id" value={product.id} />
        <h2 className="text-sm font-semibold text-red-950">{t("flagTitle")}</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] flex-1 flex flex-col gap-1 text-sm">
            <span className="text-red-900">{t("reason")}</span>
            <input
              name="flagged_reason"
              required
              defaultValue={work?.flagged_reason ?? ""}
              className="rounded-md border border-red-300 bg-white px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={flagging}
            className="cursor-pointer rounded-md border border-red-300 px-4 py-2 text-sm text-red-900 disabled:opacity-60"
          >
            {flagging ? t("flagging") : t("flagProblem")}
          </button>
        </div>
        {flagState.error ? <p className="mt-2 text-sm text-red-700">{flagState.error}</p> : null}
        {flagState.ok ? <p className="mt-2 text-sm text-red-800">{t("productFlagged")}</p> : null}
      </form>
    </div>
  );
}

function Input({
  label,
  unit,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; unit?: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[var(--muted)]">
        {label}
        {unit ? <span className="font-semibold text-[var(--ink)]"> ({unit})</span> : null}
      </span>
      <span className="flex items-stretch overflow-hidden rounded-md border border-[var(--line)] bg-white">
        <input {...props} className="min-w-0 flex-1 px-3 py-2 outline-none" />
        {unit ? (
          <span className="flex items-center border-l border-[var(--line)] bg-[var(--card-soft)] px-2.5 text-xs font-semibold whitespace-nowrap text-[var(--muted)]">
            {unit}
          </span>
        ) : null}
      </span>
      {hint ? <span className="text-xs text-[var(--muted)]">{hint}</span> : null}
    </label>
  );
}
