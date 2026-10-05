"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/app/actions/admin";
import {
  createAdjustmentAction,
  createFixedCostAction,
  deleteAdjustmentAction,
  deleteFixedCostAction,
} from "@/app/actions/finance";
import { FIXED_COST_CATEGORIES, FIXED_COST_PERIODS } from "@/lib/finance/weeks";

const initial: ActionResult = { ok: false };
const inputClass = "rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

function Submit({ state, pending, idle, saved }: { state: ActionResult; pending: boolean; idle: string; saved: string }) {
  const t = useTranslations("admin.finance.forms");
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? t("saving") : idle}
      </button>
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-800">{saved}</p> : null}
    </div>
  );
}

export function FixedCostForm({ today }: { today: string }) {
  const t = useTranslations("admin.finance");
  const [state, action, pending] = useActionState(createFixedCostAction, initial);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={t("forms.label")}>
        <input name="label" required minLength={2} className={inputClass} placeholder={t("forms.labelPlaceholder")} />
      </Field>
      <Field label={t("forms.amount")}>
        <input name="amount_eur" type="number" min="0" step="0.01" required className={inputClass} />
      </Field>
      <Field label={t("forms.period")}>
        <select name="period" defaultValue="monthly" className={inputClass}>
          {FIXED_COST_PERIODS.map((period) => (
            <option key={period} value={period}>
              {t(`periods.${period}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("forms.category")}>
        <select name="category" defaultValue="autre" className={inputClass}>
          {FIXED_COST_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(`categories.${category}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("forms.start")}>
        <input name="start_date" type="date" required defaultValue={today} className={inputClass} />
      </Field>
      <Field label={t("forms.end")}>
        <input name="end_date" type="date" className={inputClass} />
      </Field>
      <Field label={t("forms.notes")}>
        <input name="notes" className={inputClass} />
      </Field>
      <div className="flex items-end sm:col-span-2 lg:col-span-2">
        <Submit state={state} pending={pending} idle={t("forms.addCost")} saved={t("forms.costSaved")} />
      </div>
    </form>
  );
}

export function AdjustmentForm({ today }: { today: string }) {
  const t = useTranslations("admin.finance");
  const [state, action, pending] = useActionState(createAdjustmentAction, initial);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={t("forms.weekDate")}>
        <input name="week_date" type="date" required defaultValue={today} className={inputClass} />
      </Field>
      <Field label={t("forms.label")}>
        <input name="label" required minLength={2} className={inputClass} placeholder={t("forms.adjustmentPlaceholder")} />
      </Field>
      <Field label={t("forms.kind")}>
        <select name="kind" defaultValue="cost" className={inputClass}>
          <option value="revenue">{t("kinds.revenue")}</option>
          <option value="cost">{t("kinds.cost")}</option>
        </select>
      </Field>
      <Field label={t("forms.signedAmount")}>
        <input name="amount_eur" type="number" step="0.01" required className={inputClass} />
      </Field>
      <Field label={t("forms.notes")}>
        <input name="notes" className={inputClass} />
      </Field>
      <div className="flex items-end">
        <Submit state={state} pending={pending} idle={t("forms.addAdjustment")} saved={t("forms.adjustmentSaved")} />
      </div>
    </form>
  );
}

export function DeleteFixedCostButton({ id }: { id: string }) {
  const t = useTranslations("admin.finance.forms");
  return (
    <form action={deleteFixedCostAction}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="cursor-pointer text-xs text-[var(--rust-ink)] hover:underline">
        {t("delete")}
      </button>
    </form>
  );
}

export function DeleteAdjustmentButton({ id }: { id: string }) {
  const t = useTranslations("admin.finance.forms");
  return (
    <form action={deleteAdjustmentAction}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="cursor-pointer text-xs text-[var(--rust-ink)] hover:underline">
        {t("delete")}
      </button>
    </form>
  );
}
