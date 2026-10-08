"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { updateClientWhatsappAction, type ActionResult } from "@/app/actions/admin";

const initial: ActionResult = { ok: false };

export function WhatsappNumberForm({ clientId, current }: { clientId: string; current: string | null }) {
  const t = useTranslations("admin.shopForms");
  const [state, action, pending] = useActionState(updateClientWhatsappAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="client_id" value={clientId} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("whatsappLabel")}</span>
        <input
          name="whatsapp_number"
          defaultValue={current ?? ""}
          placeholder="+33612345678"
          className="w-56 rounded-md border border-[var(--line)] bg-white px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-[var(--line)] px-4 py-2 text-sm hover:bg-white disabled:opacity-60"
      >
        {pending ? t("saving") : t("save")}
      </button>
      {state.ok ? <span className="text-sm text-[var(--accent)]">{t("saved")}</span> : null}
      {state.error ? <span className="text-sm text-red-700">{state.error}</span> : null}
    </form>
  );
}
