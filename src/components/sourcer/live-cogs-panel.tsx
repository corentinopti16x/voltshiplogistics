"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  previewSourcingCogsAction,
  type SourcingPreviewInput,
  type SourcingPreviewResult,
} from "@/app/actions/sourcing-preview";

const DEBOUNCE_MS = 450;

function eur(value: number) {
  return `${value.toFixed(2).replace(".", ",")} €`;
}

/**
 * COGS computed live from the values being typed on the sourcing form (not saved yet).
 * Sticky beside the form so the sourcer sees the result without scrolling or saving.
 */
export function LiveCogsPanel({ input }: { input: SourcingPreviewInput }) {
  const t = useTranslations("sourcer.live");
  const [result, setResult] = useState<SourcingPreviewResult | null>(null);
  const [pending, startTransition] = useTransition();
  const key = JSON.stringify(input);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      lastKey.current = key;
      startTransition(async () => {
        const next = await previewSourcingCogsAction(JSON.parse(key) as SourcingPreviewInput);
        // Ignore an answer that arrives after the values changed again.
        if (lastKey.current === key) setResult(next);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key]);

  const primary = result?.markets[0];
  const single = primary?.cells[0] ?? null;

  return (
    <aside className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 lg:sticky lg:top-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <span className="text-[11px] text-[var(--muted)]">{pending ? t("computing") : t("unsaved")}</span>
      </div>
      {!result ? (
        <p className="mt-3 text-xs text-[var(--muted)]">{t("computing")}</p>
      ) : !result.ok ? (
        <p className="mt-3 text-xs text-red-700">{t("error")}</p>
      ) : result.missing === "product_data" ? (
        <p className="mt-3 text-xs text-[var(--muted)]">{t("missingData")}</p>
      ) : result.missing === "grid" ? (
        <p className="mt-3 text-xs text-[var(--muted)]">{t("missingGrid")}</p>
      ) : (
        <>
          {single ? (
            <div className="mt-3">
              <p className="text-xs text-[var(--muted)]">
                {t("oneUnit", { market: primary?.destination ?? "" })}
              </p>
              <p className="font-display text-3xl">{eur(single.cogs)}</p>
              <dl className="mt-2 space-y-1 text-xs">
                <Row label={t("product")} value={eur(single.product)} />
                {single.box > 0 ? <Row label={t("box")} value={eur(single.box)} warn /> : null}
                <Row label={t("shipping", { weight: single.weightG })} value={eur(single.shipping)} />
                <Row label={t("handling")} value={eur(single.handling)} />
              </dl>
              {single.lineName ? <p className="mt-1 text-[11px] text-[var(--muted)]">{single.lineName}</p> : null}
            </div>
          ) : (
            <p className="mt-3 text-xs text-[var(--muted)]">{t("noLine")}</p>
          )}
          <table className="mt-4 w-full text-xs">
            <thead>
              <tr className="text-[var(--muted)]">
                <th className="text-left font-normal">{t("market")}</th>
                <th className="text-right font-normal">×1</th>
                <th className="text-right font-normal">×2</th>
                <th className="text-right font-normal">×3</th>
              </tr>
            </thead>
            <tbody>
              {result.markets.map((market) => (
                <tr key={market.destination} className="border-t border-[var(--line)]">
                  <td className="py-1">{market.destination}</td>
                  {market.cells.map((cell, index) => (
                    <td key={index} className="py-1 text-right tabular-nums">
                      {cell ? eur(cell.cogs) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="mt-3 text-[11px] text-[var(--muted)]">{t("hint")}</p>
    </aside>
  );
}

function Row({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${warn ? "font-semibold text-amber-800" : ""}`}>
      <dt className={warn ? "" : "text-[var(--muted)]"}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
