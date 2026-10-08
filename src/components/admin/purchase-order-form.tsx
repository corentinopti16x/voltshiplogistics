"use client";

import { useActionState, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { createPurchaseOrderAction, type PurchaseOrderActionResult } from "@/app/actions/purchase-orders";
import { PURCHASE_ORDER_STATUSES } from "@/lib/purchase-orders/core";

const initial: PurchaseOrderActionResult = { ok: false };

export type PurchaseOrderProductOption = {
  id: string;
  clientId: string;
  title: string;
  clientPrice: number | null;
};

export function PurchaseOrderForm({
  clients,
  products,
  defaults,
}: {
  clients: Array<{ id: string; name: string }>;
  products: PurchaseOrderProductOption[];
  defaults: { clientId?: string; productId?: string; qty?: string; restockAt?: string };
}) {
  const t = useTranslations("admin.orders");
  const [state, action, pending] = useActionState(createPurchaseOrderAction, initial);
  const [clientId, setClientId] = useState(defaults.clientId ?? "");
  const [productId, setProductId] = useState(defaults.productId ?? "");
  const [qty, setQty] = useState(defaults.qty ?? "");
  const [unit, setUnit] = useState("");
  const options = useMemo(() => products.filter((product) => product.clientId === clientId), [products, clientId]);
  const selected = options.find((product) => product.id === productId) ?? null;
  const unitValue = unit.trim() ? Number(unit.replace(",", ".")) : selected?.clientPrice ?? null;
  const total = qty && unitValue != null && Number.isFinite(unitValue) ? Number(qty) * unitValue : null;

  const field = "rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm";
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {defaults.restockAt ? <input type="hidden" name="restock_at" value={defaults.restockAt} /> : null}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">{t("form.client")} *</span>
        <select
          name="client_id"
          required
          value={clientId}
          onChange={(event) => {
            setClientId(event.target.value);
            setProductId("");
          }}
          className={field}
        >
          <option value="">—</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">{t("form.product")}</span>
        <select name="product_id" value={productId} onChange={(event) => setProductId(event.target.value)} className={field}>
          <option value="">{t("form.noProduct")}</option>
          {options.map((product) => (
            <option key={product.id} value={product.id}>
              {product.title}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">{t("form.title")}</span>
        <input name="title" placeholder={selected?.title ?? t("form.titlePlaceholder")} className={field} maxLength={200} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">{t("form.quantity")} *</span>
        <input
          name="quantity"
          type="number"
          min="1"
          step="1"
          required
          value={qty}
          onChange={(event) => setQty(event.target.value)}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">{t("form.unitPrice")} (€ EUR)</span>
        <input
          name="unit_price_eur"
          type="number"
          min="0"
          step="0.0001"
          value={unit}
          placeholder={selected?.clientPrice != null ? String(selected.clientPrice) : ""}
          onChange={(event) => setUnit(event.target.value)}
          className={field}
        />
        <span className="text-xs text-[var(--muted)]">{t("form.unitHint")}</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">{t("form.total")} (€ EUR)</span>
        <input
          name="total_eur"
          type="number"
          min="0"
          step="0.01"
          placeholder={total != null ? total.toFixed(2) : ""}
          className={field}
        />
        <span className="text-xs text-[var(--muted)]">{t("form.totalHint")}</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">{t("form.status")}</span>
        <select name="status" defaultValue="to_pay" className={field}>
          {PURCHASE_ORDER_STATUSES.filter((status) => status !== "cancelled").map((status) => (
            <option key={status} value={status}>
              {t(`status.${status}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">{t("form.eta")}</span>
        <input name="eta" type="date" className={field} />
      </label>
      <div />
      <label className="flex flex-col gap-1 text-sm sm:col-span-2 lg:col-span-3">
        <span className="text-[var(--muted)]">{t("form.notesClient")}</span>
        <textarea name="notes_client" rows={2} className={field} placeholder={t("form.notesClientHint")} />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2 lg:col-span-3">
        <span className="text-[var(--muted)]">🔒 {t("form.notesInternal")}</span>
        <textarea name="notes_internal" rows={2} className={field} placeholder={t("form.notesInternalHint")} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
        <button
          disabled={pending}
          className="rounded-lg bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? t("form.creating") : t("form.create")}
        </button>
        {state.error ? <span className="text-sm text-[var(--rust-ink)]">{state.error}</span> : null}
        {state.ok ? <span className="text-sm text-[var(--green-ink)]">{t("form.created")}</span> : null}
      </div>
    </form>
  );
}
