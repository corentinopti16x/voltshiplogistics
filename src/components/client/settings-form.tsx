"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { updateFinancialProfileAction } from "@/app/actions/client";
import type { ActionResult } from "@/app/actions/admin";
import type { FinancialProfile } from "@/lib/domain/economics";

const initial: ActionResult = { ok: false };

export function SettingsForm({
  profile,
  safetyBufferDays,
  coverageTargetDays,
}: {
  profile: FinancialProfile;
  safetyBufferDays: number;
  coverageTargetDays: number;
}) {
  const t = useTranslations("settings");
  const [state, action, pending] = useActionState(updateFinancialProfileAction, initial);

  const fields = [
    ["psp_pct", profile.psp_pct],
    ["urssaf_pct", profile.urssaf_pct],
    ["vat_pct", profile.vat_pct],
    ["other_pct", profile.other_pct],
    ["min_margin_pct", profile.min_margin_pct],
    ["target_margin_pct", profile.target_margin_pct],
  ] as const;

  return (
    <form action={action} className="flex max-w-lg flex-col gap-4">
      <p className="text-xs text-[var(--muted)]">{t("disclaimer")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(([name, value]) => (
          <label key={name} className="flex flex-col gap-1.5 text-sm">
            <span className="text-[var(--muted)]">{t(`fields.${name}`)}</span>
            <input
              name={name}
              type="number"
              step="0.1"
              min="0"
              defaultValue={value}
              className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
            />
          </label>
        ))}
      </div>
      <div className="mt-2 grid gap-4 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[var(--muted)]">{t("fields.safety_buffer_days")}</span>
          <input
            name="safety_buffer_days"
            type="number"
            step="1"
            min="0"
            max="180"
            defaultValue={safetyBufferDays}
            className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[var(--muted)]">{t("fields.coverage_target_days")}</span>
          <input
            name="coverage_target_days"
            type="number"
            step="1"
            min="1"
            max="365"
            defaultValue={coverageTargetDays}
            className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
          />
        </label>
      </div>
      <p className="text-xs text-[var(--muted)]">{t("stockLead")}</p>
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-[var(--accent)]">{t("saved")}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? t("saving") : t("save")}
      </button>
    </form>
  );
}
