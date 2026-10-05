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
    <form action={action} className="flex flex-col gap-4">
      <p className="text-xs text-[var(--muted)]">{t("disclaimer")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(([name, value]) => (
          <label key={name} className="flex flex-col gap-1.5 text-sm">
            <span className="text-[12px] font-semibold text-[var(--muted)]">{t(`fields.${name}`)}</span>
            <input
              name={name}
              type="number"
              step="0.1"
              min="0"
              defaultValue={value}
              className="vs-input"
            />
          </label>
        ))}
      </div>
      <div className="mt-2 grid gap-4 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[12px] font-semibold text-[var(--muted)]">{t("fields.safety_buffer_days")}</span>
          <input
            name="safety_buffer_days"
            type="number"
            step="1"
            min="0"
            max="180"
            defaultValue={safetyBufferDays}
            className="vs-input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[12px] font-semibold text-[var(--muted)]">{t("fields.coverage_target_days")}</span>
          <input
            name="coverage_target_days"
            type="number"
            step="1"
            min="1"
            max="365"
            defaultValue={coverageTargetDays}
            className="vs-input"
          />
        </label>
      </div>
      <p className="text-xs text-[var(--muted)]">{t("stockLead")}</p>
      {state.error ? <p className="text-sm text-[var(--rust-ink)]">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-[var(--green-ink)]">{t("saved")}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex cursor-pointer items-center justify-center rounded-[10px] bg-[var(--navy)] px-4 py-2.5 text-[14px] font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? t("saving") : t("save")}
      </button>
    </form>
  );
}
