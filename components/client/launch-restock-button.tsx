"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { requestRestockAction } from "@/app/actions/client";
import type { ActionResult } from "@/app/actions/admin";

const initial: ActionResult = { ok: false };

export function LaunchRestockButton({
  productId,
  qty,
}: {
  productId: string;
  qty: number;
}) {
  const t = useTranslations("dashboard.restock");
  const [state, action, pending] = useActionState(requestRestockAction, initial);

  return (
    <form action={action} className="flex shrink-0 flex-col items-end gap-1">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="qty" value={qty > 0 ? String(Math.ceil(qty)) : ""} />
      <input type="hidden" name="notes" value="Launch restock" />
      <button
        type="submit"
        disabled={pending || state.ok}
        className="inline-flex cursor-pointer items-center justify-center rounded-[10px] bg-[var(--navy)] px-3 py-1.5 text-[13px] font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? t("sending") : state.ok ? t("sent") : t("launch")}
      </button>
      {state.error ? (
        <p className="max-w-48 text-right text-xs text-[var(--rust-ink)]" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
