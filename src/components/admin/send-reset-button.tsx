"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { sendPasswordResetAction, type ActionResult } from "@/app/actions/admin";

const initial: ActionResult = { ok: false };

export function SendResetButton({ userId }: { userId: string }) {
  const t = useTranslations("admin");
  const [state, action, pending] = useActionState(sendPasswordResetAction, initial);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      {state.ok ? (
        <span className="text-[12px] text-[var(--accent)]">{t("resetSent")}</span>
      ) : state.error ? (
        <span className="max-w-[220px] truncate text-[12px] text-red-700" title={state.error}>
          {t("resetFailed")}
        </span>
      ) : null}
      <button
        type="submit"
        disabled={pending || state.ok}
        className="rounded-md border border-[var(--line)] px-2.5 py-1 text-[12px] font-medium hover:bg-[var(--card-soft)] disabled:opacity-60"
      >
        {pending ? t("resetSending") : t("resetSend")}
      </button>
    </form>
  );
}
