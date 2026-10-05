"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { computeEconomics, type FinancialProfile } from "@/lib/domain/economics";
import { Badge } from "@/components/ui/badge";
import { formatAmount, formatRatio } from "@/lib/format";

export type CogsMatrixCellView = {
  quantity: number;
  /** COGS for the whole order (n units), null when no weight bracket matches. */
  cogs: number | null;
  cogsPerUnit: number | null;
  weightG: number | null;
  /** Billed weight (volumetric / USA minimum); shown when it differs from weightG. */
  billedWeightG: number | null;
  iossRequired: boolean;
  carrier: string | null;
  lineName: string | null;
  weightMinG: number | null;
  weightMaxG: number | null;
  /** Parcel shipping price from the rate cell (after client discount). */
  shipping: number | null;
  deliveryRange: string | null;
};

export type CogsMatrixMarketView = {
  destination: string;
  cells: CogsMatrixCellView[];
};

/**
 * COGS 1–5 × market. Always the live grid (the accepted quote stays the contractual
 * figure for quantity 1). ROAS uses computeEconomics on AOV = selling price × n and
 * the per-order COGS, so profit, break-even and the target-margin ROAS scale with n.
 */
export function CogsMatrix({
  markets,
  quantities,
  sellingPrice,
  profile,
  gridVersion,
  gridDate,
  ratesChanged,
  missingReason,
}: {
  markets: CogsMatrixMarketView[];
  quantities: number[];
  sellingPrice: number | null;
  profile: FinancialProfile;
  gridVersion: string | null;
  gridDate: string | null;
  ratesChanged: boolean;
  missingReason: "product_data" | "grid" | null;
}) {
  const t = useTranslations("products.cogsMatrix");
  const locale = useLocale();
  const [mode, setMode] = useState<"cogs" | "roas">("cogs");
  const price = sellingPrice != null && Number.isFinite(sellingPrice) ? sellingPrice : 0;
  const gridLabel = gridDate
    ? t("gridDate", {
        date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(
          new Date(`${gridDate}T00:00:00`),
        ),
      })
    : gridVersion
      ? t("gridVersion", { version: gridVersion })
      : null;

  return (
    <section className="vs-card p-5 sm:p-6" aria-labelledby="cogs-matrix-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="cogs-matrix-title" className="font-display text-[19px] font-bold text-[var(--ink)]">
            {t("title")}
          </h2>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">{t("lead")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ratesChanged ? <Badge tone="gold">{t("ratesChanged")}</Badge> : null}
          {gridLabel ? <Badge tone="outline">{gridLabel}</Badge> : null}
          <div
            role="group"
            aria-label={t("modeLabel")}
            className="inline-flex rounded-[10px] border border-[var(--line-soft)] bg-[var(--card-soft)] p-0.5"
          >
            {(["cogs", "roas"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
                className={`rounded-[8px] px-3 py-1 text-[12px] font-bold transition ${
                  mode === option
                    ? "bg-[var(--navy)] text-white"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {t(`mode.${option}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {missingReason ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          {missingReason === "grid" ? t("missingGrid") : t("missingProduct")}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] border-separate border-spacing-y-1.5 text-left">
            <thead>
              <tr>
                <th scope="col" className="pb-1 text-[11px] font-semibold text-[var(--muted)]">
                  {t("market")}
                </th>
                {quantities.map((quantity) => (
                  <th
                    key={quantity}
                    scope="col"
                    className="pb-1 text-right text-[11px] font-semibold text-[var(--muted)]"
                  >
                    {t("units", { count: quantity })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {markets.map((market) => (
                <tr key={market.destination} className="bg-[var(--card-soft)]">
                  <th
                    scope="row"
                    className="rounded-l-[12px] px-3 py-2 text-[14px] font-bold text-[var(--ink)]"
                  >
                    {market.destination}
                  </th>
                  {market.cells.map((cell, index) => {
                    const last = index === market.cells.length - 1;
                    const cellClass = `px-3 py-2 text-right align-top ${last ? "rounded-r-[12px]" : ""}`;
                    if (cell.cogs == null) {
                      return (
                        <td key={cell.quantity} className={cellClass}>
                          <span
                            className="tabular cursor-help text-[15px] font-bold text-[var(--faint)]"
                            title={t("noRate")}
                            aria-label={t("noRate")}
                          >
                            —
                          </span>
                        </td>
                      );
                    }
                    if (mode === "roas") {
                      const economics = computeEconomics(price * cell.quantity, cell.cogs, profile);
                      return (
                        <td key={cell.quantity} className={cellClass}>
                          <span className="tabular block text-[15px] font-bold">
                            {formatRatio(economics.roasBe, locale)}
                          </span>
                          <span className="tabular block text-[12px] font-semibold text-[var(--gold-text)]">
                            {t("roasTarget", {
                              value: formatRatio(economics.roasTarget, locale),
                              margin: profile.target_margin_pct,
                            })}
                          </span>
                          <span className="block text-[11px] text-[var(--faint)]">
                            {t("aov", { value: formatAmount(price * cell.quantity, locale) })}
                          </span>
                        </td>
                      );
                    }
                    return (
                      <td
                        key={cell.quantity}
                        className={cellClass}
                        title={
                          cell.carrier && cell.weightMinG != null && cell.weightMaxG != null
                            ? `${cell.weightG} g${
                                cell.billedWeightG != null && cell.billedWeightG !== cell.weightG
                                  ? ` · ${t("billedWeight", { weight: cell.billedWeightG })}`
                                  : ""
                              } · ${t("cellDetail", {
                                carrier: cell.carrier,
                                line: cell.lineName ? ` ${cell.lineName}` : "",
                                tier: `${cell.weightMinG}–${cell.weightMaxG} g`,
                                price: formatAmount(cell.shipping, locale),
                                delivery: cell.deliveryRange ? ` · ${cell.deliveryRange}` : "",
                              })}${cell.iossRequired ? ` · ${t("iossRequired")}` : ""}`
                            : cell.weightG != null
                              ? `${cell.weightG} g`
                              : undefined
                        }
                      >
                        <span className="tabular block text-[15px] font-bold">
                          {formatAmount(cell.cogs, locale)}
                        </span>
                        <span className="tabular block text-[12px] text-[var(--muted)]">
                          {t("perUnit", { value: formatAmount(cell.cogsPerUnit, locale) })}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[12px] text-[var(--muted)]">
        {mode === "roas" ? t("roasNote", { margin: profile.target_margin_pct }) : t("formulaNote")}
      </p>
    </section>
  );
}
