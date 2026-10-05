"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { startRateImportAction, type RateImportActionResult } from "@/app/actions/pricing";
import { Button } from "@/components/ui/button";

const CARRIERS = ["4PX", "YunExpress", "Tongyou", "Huahan"] as const;
const initial: RateImportActionResult = { ok: false };

/** Step 1 — upload / paste a carrier price list and send it to the assistant. */
export function RateImportStart({ configured }: { configured: boolean }) {
  const t = useTranslations("admin.rateImport");
  const router = useRouter();
  const [state, action, pending] = useActionState(startRateImportAction, initial);
  const [matrix, setMatrix] = useState(false);

  useEffect(() => {
    if (state.ok && state.importId) {
      router.push({ pathname: "/admin/pricing/update", query: { import: state.importId } });
    }
  }, [state, router]);

  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-2 rounded-[10px] bg-[var(--grey-soft)] px-4 py-3 text-[13px] sm:grid-cols-2">
        <p>
          <span className="font-semibold">{t("step1.paths.assistantTitle")}</span>{" "}
          <span className="text-[var(--muted)]">{t("step1.paths.assistant")}</span>
        </p>
        <p>
          <span className="font-semibold">{t("step1.paths.matrixTitle")}</span>{" "}
          <span className="text-[var(--muted)]">{t("step1.paths.matrix")}</span>
        </p>
      </div>
      {!configured && !matrix ? (
        <p className="rounded-[10px] bg-[var(--rust-soft)] px-4 py-3 text-sm text-[var(--rust-ink)]">
          {t("notConfigured")}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--muted)]">{t("step1.carrier")}</span>
          <select name="carrier" className="rounded-md border border-[var(--line)] bg-white px-3 py-2">
            <option value="">{t("step1.carrierAuto")}</option>
            {CARRIERS.map((carrier) => (
              <option key={carrier} value={carrier}>
                {carrier}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--muted)]">{t("step1.hint")}</span>
          <input
            name="hint"
            maxLength={200}
            placeholder={t("step1.hintPlaceholder")}
            className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">{t("step1.files")}</span>
        <input
          name="files"
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv,.txt,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain"
          className="text-sm"
        />
      </label>
      <label className="inline-flex items-start gap-2 text-sm">
        <input
          name="matrix"
          type="checkbox"
          checked={matrix}
          onChange={(event) => setMatrix(event.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="font-semibold">{t("step1.matrix")}</span>
          <span className="block text-[12px] text-[var(--muted)]">{t("step1.matrixHelp")}</span>
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">{t("step1.text")}</span>
        <textarea
          name="text"
          rows={8}
          placeholder={t("step1.textPlaceholder")}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 font-mono text-[13px]"
        />
      </label>
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      <div>
        <Button type="submit" disabled={pending || (!configured && !matrix)}>
          {pending ? (matrix ? t("step1.submittingMatrix") : t("step1.submitting")) : matrix ? t("step1.submitMatrix") : t("step1.submit")}
        </Button>
      </div>
    </form>
  );
}
