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
          <span className="text-[var(--muted)]">{t("qty")}</span>
          <input
            name="qty"
            type="number"
            min="1"
            defaultValue={suggestedQty && suggestedQty > 0 ? suggestedQty : undefined}
            className="w-28 rounded-md border border-[var(--line)] bg-white px-3 py-2"
          />
        </label>
        <label className="min-w-[220px] flex-1 flex flex-col gap-1.5 text-sm">
          <span className="text-[var(--muted)]">{t("notes")}</span>
          <input
            name="notes"
            className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
            placeholder={t("notesPlaceholder")}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? t("sending") : t("restock")}
        </button>
      </form>
      {state.error ? (
        <p className="text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.ok ? <p className="text-sm text-emerald-800">{t("sent")}</p> : null}
      {requests.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {requests.map((item) => (
            <li key={`${item.at}-${item.notes}`} className="rounded-md bg-[var(--bg)] px-3 py-2">
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
