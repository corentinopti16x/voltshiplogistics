"use client";

import { useActionState, useEffect, useState } from "react";
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
const channelLabels: Record<ShippingChannel, string> = {
  standard: "standard",
  electronics_battery: "électronique / batterie",
  cosmetics: "cosmétique",
  liquid_perfume: "liquide / parfum",
  magnetic: "magnétique",
  sensitive_other: "sensible (ingérable)",
};
const attributeLabels: Record<string, string> = {
  electronics: "batterie / électronique",
  liquid: "liquide / crème",
  alcohol: "parfum ou alcool",
  ingestible: "ingérable",
  magnetic: "aimant",
};
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
          <h2 className="text-sm font-semibold">Client-safe quote fields</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            These values appear on the client product page.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              name="client_price"
              label="Client product price"
              unit="€ EUR"
              hint="Per unit, before the tier commission (added automatically)."
              type="number"
              min="0"
              step="0.0001"
              value={clientPrice}
              onChange={(event) => setClientPrice(event.target.value)}
            />
            <Input
              name="weight_g"
              label="Unit weight"
              unit="g"
              type="number"
              min="1"
              defaultValue={product.weight_g ?? ""}
            />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[var(--muted)]">Shipping channel</span>
              <select
                name="shipping_channel"
                defaultValue={product.shipping_channel ?? suggested ?? ""}
                className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
              >
                <option value="">Select</option>
                {channels.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              {suggested ? (
                <span className="text-xs text-[var(--muted)]">
                  Suggéré par le client : <strong>{channelLabels[suggested]}</strong>
                  {ticked.length > 0
                    ? ` (coché : ${ticked.map((key) => attributeLabels[key] ?? key).join(", ")})`
                    : " (rien coché)"}
                  {product.shipping_channel && product.shipping_channel !== suggested
                    ? " — ta valeur l'emporte"
                    : " — confirme ou corrige"}
                </span>
              ) : null}
            </label>
            <Input
              name="production_lead_days"
              label="Production lead"
              unit="days"
              type="number"
              min="0"
              defaultValue={product.production_lead_days ?? ""}
            />
            <Input
              name="moq"
              label="MOQ"
              unit="units"
              type="number"
              min="0"
              defaultValue={product.moq ?? ""}
            />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[var(--muted)]">Sourcing status</span>
              <select
                name="sourcing_status"
                defaultValue={product.sourcing_status ?? "brief_received"}
                className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
              >
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-sm font-semibold text-amber-950">Internal sourcing fields</h2>
          <p className="mt-1 text-xs text-amber-900">
            Never shown to clients.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Input
                name="factory_purchase_price"
                label="Factory purchase price"
                unit="¥ RMB"
                type="number"
                min="0"
                step="0.0001"
                value={factoryRmb}
                onChange={(event) => setFactoryRmb(event.target.value)}
              />
              {factoryEur != null ? (
                <p className="text-xs text-amber-900">
                  = {factoryEur.toFixed(2)} € at {fxRmbPerEur} ¥/€
                  {String(factoryEur) !== clientPrice ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        onClick={() => setClientPrice(String(factoryEur))}
                        className="cursor-pointer font-semibold underline"
                      >
                        Use as client product price
                      </button>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            <Input
              name="sourcing_location"
              label="Sourcing location"
              defaultValue={work?.sourcing_location ?? ""}
            />
            <Input
              name="supplier_name"
              label="Supplier name"
              defaultValue={work?.supplier_name ?? ""}
            />
            <Input
              name="supplier_contact"
              label="Supplier contact"
              defaultValue={work?.supplier_contact ?? ""}
            />
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-amber-900">Internal notes</span>
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
        {saveState.ok ? <p className="text-sm text-emerald-800">Draft saved.</p> : null}
        {sendState.ok ? <p className="text-sm text-emerald-800">Quote sent.</p> : null}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving || sending}
            className="cursor-pointer rounded-md border border-[var(--line)] px-4 py-2 text-sm hover:bg-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
          <button
            type="submit"
            formAction={sendAction}
            disabled={saving || sending}
            className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send quote"}
          </button>
        </div>
      </form>

      <form action={flagAction} className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <input type="hidden" name="product_id" value={product.id} />
        <h2 className="text-sm font-semibold text-red-950">Flag a problem</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] flex-1 flex flex-col gap-1 text-sm">
            <span className="text-red-900">Reason</span>
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
            {flagging ? "Flagging…" : "Flag problem"}
          </button>
        </div>
        {flagState.error ? <p className="mt-2 text-sm text-red-700">{flagState.error}</p> : null}
        {flagState.ok ? <p className="mt-2 text-sm text-red-800">Product flagged.</p> : null}
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
