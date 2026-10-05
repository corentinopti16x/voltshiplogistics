"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { requestRestockAction } from "@/app/actions/client";
import type { ActionResult } from "@/app/actions/admin";
import type { RestockRequest } from "@/lib/products/types";

const initial: ActionResult = { ok: false };

export function ProductStockActions({
  productId,
  requests,
  suggestedQty,
}: {
  productId: string;
  requests: RestockRequest[];
  suggestedQty?: number;
}) {
  const t = useTranslations("products.stock");
  const [state, action, pending] = useActionState(requestRestockAction, initial);

  return (
    <div className="mt-4 space-y-4">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="product_id" value={productId} />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[12px] font-semibold text-[var(--muted)]">{t("qty")}</span>
          <input
            name="qty"
            type="number"
            min="1"
            defaultValue={suggestedQty && suggestedQty > 0 ? suggestedQty : undefined}
            className="w-28 vs-input"
          />
        </label>
        <label className="min-w-[220px] flex-1 flex flex-col gap-1.5 text-sm">
          <span className="text-[12px] font-semibold text-[var(--muted)]">{t("notes")}</span>
          <input
            name="notes"
            className="vs-input"
            placeholder={t("notesPlaceholder")}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex cursor-pointer items-center justify-center rounded-[10px] bg-[var(--navy)] px-4 py-2.5 text-[14px] font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? t("sending") : t("restock")}
        </button>
      </form>
      {state.error ? (
        <p className="text-sm text-[var(--rust-ink)]" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.ok ? <p className="text-sm text-[var(--green-ink)]">{t("sent")}</p> : null}
      {requests.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {requests.map((item) => (
            <li key={`${item.at}-${item.notes}`} className="rounded-[10px] bg-[var(--card-soft)] px-3 py-2">
              <p>
                {item.qty ? `${item.qty} · ` : ""}
                {item.notes || t("sent")}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {new Date(item.at).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
