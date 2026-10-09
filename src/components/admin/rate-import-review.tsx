"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import {
  activateRateImportAction,
  discardRateImportAction,
  reviewRateImportAction,
  savePricingSettingsAction,
} from "@/app/actions/pricing";
import type { RateImportReview } from "@/lib/pricing/ai-import-server";
import type { ImportOverrides, ParsedLine } from "@/lib/pricing/ai-import";
import type { NumericPricingSetting, PricingSettings } from "@/lib/pricing/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Metric } from "@/components/ui/stat";
import { formatAmount } from "@/lib/format";

const SETTING_KEYS: NumericPricingSetting[] = [
  "fx_rmb_per_eur",
  "margin_pct",
  "min_margin_eur_per_parcel",
  "eu_parcel_tax_eur",
  "handling_cost_eur",
  "fx_market_rate",
  "handling_step2_eur",
  "handling_step3_eur",
  "handling_extra_unit_eur",
  "announced_margin_alert_eur",
];

function pricingLabel(line: ParsedLine, t: ReturnType<typeof useTranslations>) {
  if (line.pricing.type === "table") return t("step2.table", { count: line.pricing.rows.length });
  if (line.pricing.tiers?.length) return t("step2.tiers", { count: line.pricing.tiers.length });
  return t("step2.perKg", { fee: line.pricing.fee, perKg: line.pricing.per_kg });
}

/** Step 2 — review parsed lines, tune the margin rule, compare, activate. */
export function RateImportReviewPanel({ initial }: { initial: RateImportReview }) {
  const t = useTranslations("admin.rateImport");
  const locale = useLocale();
  const [review, setReview] = useState(initial);
  const [overrides, setOverrides] = useState<ImportOverrides>(initial.overrides);
  const [settingsDraft, setSettingsDraft] = useState<PricingSettings>(initial.settings);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [gridVersion, setGridVersion] = useState("");
  const [confirmLow, setConfirmLow] = useState(false);
  const [pending, startTransition] = useTransition();
  const [activating, startActivation] = useTransition();
  const locked = review.status === "activated" || review.status === "discarded";
  // "TOUT COMPRIS" matrix: every price is final, no tax flag to flip.
  const allInclusive = review.parsed.all_inclusive === true;

  const eur = (value: number | null | undefined) => formatAmount(value, locale);

  function recompute(next: ImportOverrides) {
    setOverrides(next);
    setError(null);
    startTransition(async () => {
      const result = await reviewRateImportAction(review.importId, next);
      if (!result.ok || !result.review) {
        setError(result.error ?? "Error");
        return;
      }
      setReview(result.review);
      setSettingsDraft(result.review.settings);
    });
  }

  function toggleLine(index: number, patch: { include?: boolean; tax_included?: boolean }) {
    const key = String(index);
    recompute({
      ...overrides,
      lines: { ...(overrides.lines ?? {}), [key]: { ...(overrides.lines?.[key] ?? {}), ...patch } },
    });
  }

  function applySettings() {
    recompute({ ...overrides, settings: { ...settingsDraft } });
  }

  function saveDefault() {
    const formData = new FormData();
    for (const key of SETTING_KEYS) formData.set(key, String(settingsDraft[key]));
    startTransition(async () => {
      const result = await savePricingSettingsAction(undefined, formData);
      if (!result.ok) setError(result.error ?? "Error");
      else setNotice(t("step2.settings.savedDefault"));
    });
  }

  function activate() {
    if (!window.confirm(t("step2.activate.confirm"))) return;
    setError(null);
    startActivation(async () => {
      const result = await activateRateImportAction(review.importId, {
        gridVersion: gridVersion || null,
        confirmLowConfidence: confirmLow,
      });
      if (!result.ok) {
        setError(result.error ?? "Error");
        return;
      }
      setReview({ ...review, status: "activated", gridVersion: result.gridVersion ?? null });
      setNotice(
        t("step2.activate.done", {
          version: result.gridVersion ?? "",
          cells: result.counts?.cells ?? 0,
          lines: result.counts?.lines ?? 0,
        }),
      );
    });
  }

  function discard() {
    startActivation(async () => {
      const result = await discardRateImportAction(review.importId);
      if (!result.ok) setError(result.error ?? "Error");
      else {
        setReview({ ...review, status: "discarded" });
        setNotice(t("step2.activate.discarded"));
      }
    });
  }

  const sampleAt500 = (index: number) =>
    review.cells.find((cell) => cell.lineIndex === index && 500 >= cell.weightMinG && 500 <= cell.weightMaxG) ??
    review.cells.find((cell) => cell.lineIndex === index) ??
    null;

  return (
    <div className="flex flex-col gap-5">
      <Card as="section" padding="md">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[19px] font-bold">{t("step2.title")}</h2>
            <p className="mt-0.5 text-[13px] text-[var(--muted)]">{t("step2.lead")}</p>
          </div>
          <Link href="/admin/pricing/update" className="text-[13px] font-semibold text-[var(--blue-ink)] hover:underline">
            ← {t("step1.title")}
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {review.carriers.length > 1 ? (
            <Metric label={t("step2.carriers")} value={review.carriers.length} />
          ) : (
            <Metric label={t("step2.carrier")} value={review.carrier} />
          )}
          <Metric label={t("step2.gridDate")} value={review.parsed.grid_date ?? "—"} />
          <Metric label={t("step2.activeGrid")} value={review.activeGridVersion ?? t("step2.noActiveGrid")} />
          <Metric label={t("step2.summary.cells")} value={review.summary.cells} />
          <Metric label={t("step2.summary.carried")} value={review.carriedForwardCells} />
          <Metric
            label={t("step2.summary.lines")}
            value={`${review.summary.includedLines} / ${review.summary.lines}`}
          />
          <Metric
            label={t("step2.summary.lowConfidence")}
            value={review.summary.lowConfidenceLines}
            tone={review.summary.lowConfidenceLines > 0 ? "warning" : "default"}
          />
        </div>
        {review.carriers.length > 1 ? (
          <p className="mt-3 text-[13px] text-[var(--muted)]">
            <span className="font-semibold text-[var(--ink)]">{t("step2.perCarrier")}</span>{" "}
            {review.carriers
              .map((carrier) => {
                const counts = review.summary.perCarrier[carrier];
                return `${carrier} ${counts ? `${counts.included}/${counts.lines}` : "0"}`;
              })
              .join(" · ")}
          </p>
        ) : null}
        {review.status === "activated" ? (
          <p className="mt-4 rounded-[10px] bg-[var(--green-soft)] px-4 py-3 text-sm text-[var(--green-ink)]">
            {t("step2.statusActivated", { version: review.gridVersion ?? "" })}
          </p>
        ) : null}
        {review.status === "discarded" ? (
          <p className="mt-4 rounded-[10px] bg-[var(--grey-soft)] px-4 py-3 text-sm text-[var(--muted)]">
            {t("step2.statusDiscarded")}
          </p>
        ) : null}
        {allInclusive ? (
          <p className="mt-4 rounded-[10px] bg-[var(--blue-soft)] px-4 py-3 text-[13px] text-[var(--blue-ink)]">
            {t("step2.allInclusive")}
          </p>
        ) : null}
        {review.parsed.warnings.length > 0 ? (
          <div className="mt-4 rounded-[10px] bg-[var(--gold-soft)] px-4 py-3 text-[13px] text-[var(--gold-ink)]">
            <p className="font-semibold">{t("step2.warnings")}</p>
            <ul className="mt-1 list-disc pl-5">
              {review.parsed.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {/* Parsed lines */}
      <Card as="section" padding="none" className="overflow-hidden">
        <div className="p-5 sm:p-6">
          <h3 className="font-display text-[15px] font-bold">{t("step2.lines")}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-[13px]">
            <thead className="border-y border-[var(--line)] text-[11px] text-[var(--muted)]">
              <tr>
                <th className="px-4 py-2">{t("step2.columns.include")}</th>
                <th className="px-4 py-2">{t("step2.columns.destination")}</th>
                <th className="px-4 py-2">{t("step2.columns.channel")}</th>
                {review.carriers.length > 1 ? <th className="px-4 py-2">{t("step2.carrier")}</th> : null}
                <th className="px-4 py-2">{t("step2.columns.line")}</th>
                <th className="px-4 py-2">{t("step2.columns.pricing")}</th>
                {!allInclusive ? <th className="px-4 py-2">{t("step2.columns.tax")}</th> : null}
                {!allInclusive ? <th className="px-4 py-2">{t("step2.columns.vat")}</th> : null}
                <th className="px-4 py-2">{t("step2.columns.ioss")}</th>
                <th className="px-4 py-2">{t("step2.columns.delivery")}</th>
                <th className="px-4 py-2">{t("step2.columns.confidence")}</th>
                <th className="px-4 py-2 text-right">{t("step2.columns.sample")}</th>
                <th className="px-4 py-2">{t("step2.columns.notes")}</th>
              </tr>
            </thead>
            <tbody>
              {review.parsed.lines.map((line, index) => {
                const override = overrides.lines?.[String(index)];
                const included = override?.include ?? !line.vat_extra;
                const taxIncluded = override?.tax_included ?? line.tax_included;
                const low = line.confidence < 0.5;
                const sample = sampleAt500(index);
                return (
                  <tr
                    key={index}
                    className={`border-b border-[var(--line)] ${included ? "" : "opacity-50"}`}
                  >
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={included}
                        disabled={locked || pending}
                        onChange={(event) => toggleLine(index, { include: event.target.checked })}
                        aria-label={t("step2.columns.include")}
                      />
                    </td>
                    <td className="px-4 py-2 font-bold">{line.destination}</td>
                    <td className="px-4 py-2">{line.channel.replaceAll("_", " ")}</td>
                    {review.carriers.length > 1 ? (
                      <td className="px-4 py-2">{line.carrier ?? review.carrier}</td>
                    ) : null}
                    <td className="px-4 py-2 font-semibold">{line.line_name}</td>
                    <td className="tabular px-4 py-2">{pricingLabel(line, t)}</td>
                    {!allInclusive ? (
                    <td className="px-4 py-2">
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={taxIncluded}
                          disabled={locked || pending}
                          onChange={(event) => toggleLine(index, { tax_included: event.target.checked })}
                          aria-label={t("step2.columns.tax")}
                        />
                        {taxIncluded ? (
                          <span>{t("step2.taxYes")}</span>
                        ) : (
                          <span className="text-[var(--rust-ink)]">
                            ⚠ {t("step2.taxNo", { tax: eur(review.settings.eu_parcel_tax_eur) })}
                          </span>
                        )}
                      </label>
                    </td>
                    ) : null}
                    {!allInclusive ? (
                    <td className="px-4 py-2">
                      {line.vat_extra ? (
                        <span className="text-[var(--rust-ink)]" title={t("step2.vatExtra")}>
                          ⚠ {t("step2.columns.vat")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    ) : null}
                    <td className="px-4 py-2">
                      {line.ioss_required ? <Badge tone="blue">{t("step2.iossRequired")}</Badge> : "—"}
                    </td>
                    <td className="px-4 py-2">{line.delivery_range ?? "—"}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2" title={`${Math.round(line.confidence * 100)} %`}>
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--line-soft)]" aria-hidden>
                          <span
                            className={`block h-full rounded-full ${low ? "bg-[#E07B45]" : "bg-[var(--green-ink)]"}`}
                            style={{ width: `${Math.round(line.confidence * 100)}%` }}
                          />
                        </span>
                        <span className="tabular text-[11px] text-[var(--muted)]">
                          {Math.round(line.confidence * 100)} %
                        </span>
                        {low ? <Badge tone="rust">{t("step2.lowConfidence")}</Badge> : null}
                      </div>
                    </td>
                    <td className="tabular px-4 py-2 text-right font-bold">
                      {sample ? (
                        <span title={`${sample.carrierCostRmb} RMB · ${sample.weightMinG}–${sample.weightMaxG} g`}>
                          {eur(sample.price)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-[260px] px-4 py-2 text-[12px] text-[var(--muted)]">
                      {[line.notes, line.volumetric_divisor ? `÷${line.volumetric_divisor}` : null, line.min_billable_g ? `min ${line.min_billable_g} g` : null]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
        {/* Margin settings */}
        <Card as="section" padding="md">
          <h3 className="font-display text-[15px] font-bold">{t("step2.settings.title")}</h3>
          <p className="mt-0.5 text-[12px] text-[var(--muted)]">{t("step2.settings.lead")}</p>
          <div className="mt-4 grid gap-3">
            {(
              [
                ["fx_rmb_per_eur", t("step2.settings.fx"), "0.01"],
                ["margin_pct", t("step2.settings.margin"), "0.1"],
                ["min_margin_eur_per_parcel", t("step2.settings.minMargin"), "0.05"],
                ["eu_parcel_tax_eur", t("step2.settings.euTax"), "0.05"],
                ["handling_cost_eur", t("step2.settings.handlingCost"), "0.05"],
                ["fx_market_rate", t("step2.settings.fxMarket"), "0.01"],
                ["handling_step2_eur", t("step2.settings.handlingStep2"), "0.05"],
                ["handling_step3_eur", t("step2.settings.handlingStep3"), "0.05"],
                ["handling_extra_unit_eur", t("step2.settings.handlingExtraUnit"), "0.05"],
                ["announced_margin_alert_eur", t("step2.settings.announcedAlert"), "0.05"],
              ] as const
            ).map(([key, label, step]) => (
              <label key={key} className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">{label}</span>
                <input
                  type="number"
                  step={step}
                  min="0"
                  value={settingsDraft[key]}
                  disabled={locked}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, [key]: Number(event.target.value) })
                  }
                  className="tabular rounded-md border border-[var(--line)] bg-white px-3 py-2"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={applySettings} disabled={locked || pending}>
              {pending ? t("step2.settings.applying") : t("step2.settings.apply")}
            </Button>
            <Button size="sm" variant="secondary" onClick={saveDefault} disabled={pending}>
              {t("step2.settings.saveDefault")}
            </Button>
          </div>
        </Card>

        {/* Comparison */}
        <Card as="section" padding="none" className="overflow-hidden">
          <div className="p-5 sm:p-6">
            <h3 className="font-display text-[15px] font-bold">{t("step2.comparison.title")}</h3>
            <p className="mt-0.5 text-[12px] text-[var(--muted)]">{t("step2.comparison.lead")}</p>
          </div>
          {review.comparison.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-[var(--muted)]">{t("step2.comparison.empty")}</p>
          ) : (
            <div className={`overflow-x-auto ${pending ? "opacity-60" : ""}`}>
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="border-y border-[var(--line)] text-[11px] text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-2">{t("step2.comparison.destination")}</th>
                    <th className="px-4 py-2">{t("step2.comparison.channel")}</th>
                    <th className="px-4 py-2 text-right">{t("step2.comparison.weight")}</th>
                    <th className="px-4 py-2">{t("step2.comparison.old")}</th>
                    <th className="px-4 py-2">{t("step2.comparison.new")}</th>
                    <th className="px-4 py-2 text-right">{t("step2.comparison.delta")}</th>
                  </tr>
                </thead>
                <tbody>
                  {review.comparison.map((row) => {
                    const delta = row.deltaPct;
                    const tone =
                      delta == null
                        ? "text-[var(--muted)]"
                        : delta < 0
                          ? "text-[var(--green-ink)]"
                          : delta > 0
                            ? "text-[var(--rust-ink)]"
                            : "text-[var(--muted)]";
                    return (
                      <tr key={`${row.destination}-${row.channel}-${row.weightG}`} className="border-b border-[var(--line)]">
                        <td className="px-4 py-2 font-bold">{row.destination}</td>
                        <td className="px-4 py-2">{row.channel.replaceAll("_", " ")}</td>
                        <td className="tabular px-4 py-2 text-right">{row.weightG} g</td>
                        <td className="px-4 py-2">
                          {row.old ? (
                            <>
                              <span className="font-semibold">{eur(row.old.price)}</span>{" "}
                              <span className="text-[var(--muted)]">
                                {row.old.carrier}
                                {row.old.lineName ? ` · ${row.old.lineName}` : ""}
                              </span>
                            </>
                          ) : (
                            <span className="text-[var(--faint)]">{t("step2.comparison.none")}</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {row.new ? (
                            <>
                              <span className="font-semibold">{eur(row.new.price)}</span>{" "}
                              <span className="text-[var(--muted)]">
                                {row.new.carrier}
                                {row.new.lineName ? ` · ${row.new.lineName}` : ""}
                              </span>
                            </>
                          ) : (
                            <span className="text-[var(--faint)]">{t("step2.comparison.none")}</span>
                          )}
                        </td>
                        <td className={`tabular px-4 py-2 text-right font-bold ${tone}`}>
                          {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} %`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Activate */}
      <Card as="section" padding="md">
        <h3 className="font-display text-[15px] font-bold">{t("step2.activate.title")}</h3>
        <p className="mt-0.5 text-[12px] text-[var(--muted)]">{t("step2.activate.lead")}</p>
        {!locked ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-[320px_minmax(0,1fr)] sm:items-end">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[var(--muted)]">{t("step2.activate.version")}</span>
              <input
                value={gridVersion}
                onChange={(event) => setGridVersion(event.target.value)}
                placeholder={t("step2.activate.versionPlaceholder")}
                className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
              />
            </label>
            <div className="flex flex-col gap-3">
              {review.lowConfidence ? (
                <label className="inline-flex items-center gap-2 text-sm text-[var(--rust-ink)]">
                  <input
                    type="checkbox"
                    checked={confirmLow}
                    onChange={(event) => setConfirmLow(event.target.checked)}
                  />
                  {t("step2.activate.confirmLow")}
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="gold"
                  onClick={activate}
                  disabled={activating || pending || review.cells.length === 0 || (review.lowConfidence && !confirmLow)}
                >
                  {activating ? t("step2.activate.activating") : t("step2.activate.button")}
                </Button>
                <Button variant="ghost" onClick={discard} disabled={activating || pending}>
                  {t("step2.activate.discard")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        {notice ? <p className="mt-3 text-sm text-emerald-800">{notice}</p> : null}
      </Card>
    </div>
  );
}
