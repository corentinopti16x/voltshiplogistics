"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  runLineCheckAction,
  saveZipCoverageAction,
  type LineRoutingActionResult,
} from "@/app/actions/line-routing";

const initial: LineRoutingActionResult = { ok: false };

const inputClass = "rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm disabled:opacity-60";
const buttonClass =
  "cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60";
const secondaryClass =
  "cursor-pointer rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-medium disabled:opacity-60";

export type ZipCoverageLineOption = { value: string; label: string };

function ErrorText({ state }: { state: LineRoutingActionResult }) {
  const t = useTranslations("admin.linesPage.errors");
  if (state.ok || (!state.code && !state.error)) return null;
  const text = state.code ? t(state.code, { count: state.saved ?? 0 }) : state.error;
  return <p className="text-sm text-red-700">{text}</p>;
}

/** Import of a line's postcode list: pasted and/or uploaded (.csv / .txt), replaces the old list. */
export function ZipCoverageForm({ lines }: { lines: ZipCoverageLineOption[] }) {
  const t = useTranslations("admin.linesPage.form");
  const [state, save, saving] = useActionState(saveZipCoverageAction, initial);
  return (
    <form action={save} className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("line")}</span>
          <select name="line" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              {t("linePlaceholder")}
            </option>
            {lines.map((line) => (
              <option key={line.value} value={line.value}>
                {line.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("mode")}</span>
          <select name="mode" defaultValue="only" className={inputClass}>
            <option value="only">{t("modeOnly")}</option>
            <option value="except">{t("modeExcept")}</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("zips")}</span>
        <textarea name="zips" rows={5} placeholder={t("zipsPlaceholder")} className={`${inputClass} font-mono`} />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("file")}</span>
          <input type="file" name="file" accept=".csv,.txt,text/csv,text/plain" className="text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("note")}</span>
          <input name="note" placeholder={t("notePlaceholder")} className={inputClass} />
        </label>
      </div>
      <p className="text-xs text-[var(--muted)]">{t("help")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className={buttonClass}>
          {saving ? t("saving") : t("save")}
        </button>
        {state.ok ? <p className="text-sm text-emerald-800">{t("saved", { count: state.saved ?? 0 })}</p> : null}
        <ErrorText state={state} />
      </div>
      {state.invalid && state.invalid.length > 0 ? (
        <p className="text-xs text-amber-800">
          {t("invalid")} <span className="font-mono">{state.invalid.join(", ")}</span>
        </p>
      ) : null}
    </form>
  );
}

/** Re-checks the last 7 days now (after a list or the method map changed). */
export function LineCheckButton() {
  const t = useTranslations("admin.linesPage");
  const [state, run, running] = useActionState(runLineCheckAction, initial);
  return (
    <form action={run} className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={running} className={secondaryClass}>
        {running ? t("checking") : t("checkNow")}
      </button>
      {state.ok && state.summary ? (
        <p className="text-sm text-[var(--muted)]">
          {t("checkDone", {
            checked: state.summary.checked,
            moreExpensive: state.summary.moreExpensive,
            extra: state.summary.extraRmb.toFixed(2),
          })}
        </p>
      ) : null}
      <ErrorText state={state} />
    </form>
  );
}
