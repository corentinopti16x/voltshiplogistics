"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { setVariantUnitsAction } from "@/app/actions/sourcing";
import type { VariantPriceMarket, VariantPriceRow } from "@/lib/products/variant-prices-server";

const tone = {
  good: "bg-emerald-50 text-emerald-800",
  limit: "bg-amber-50 text-amber-900",
  bad: "bg-[var(--rust-soft)] text-[var(--rust-ink)]",
} as const;

/** Landed cost and verdict for each Shopify variant (lots, packs), pieces editable by the team. */
export function VariantPrices({
  productId,
  markets,
}: {
  productId: string;
  markets: VariantPriceMarket[];
}) {
  const t = useTranslations("sourcer.live.variants");
  return (
    <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
      <h2 className="text-sm font-semibold">{t("title")}</h2>
      <p className="mt-1 max-w-2xl text-xs text-[var(--muted)]">{t("lead")}</p>
      {markets.map((market) => (
        <div key={market.destination} className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="mb-2 text-left text-xs font-semibold text-[var(--muted)]">
              {market.destination}
            </caption>
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="py-2 pr-3 font-medium">{t("variant")}</th>
                <th className="py-2 pr-3 font-medium">{t("pieces")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("selling")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("cogs")}</th>
                <th className="py-2 font-medium">{t("verdict")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {market.rows.map((row) => (
                <Line key={row.ids[0]} productId={productId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="mt-3 text-[11px] text-[var(--muted)]">{t("rule")}</p>
    </section>
  );
}

function Line({ productId, row }: { productId: string; row: VariantPriceRow }) {
  const t = useTranslations("sourcer.live.variants");
  const router = useRouter();
  const [value, setValue] = useState(String(row.units));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = (confirm = false) => {
    const text = value.trim();
    // Leaving the field without changing it saves nothing; Enter confirms a guessed number.
    if (!confirm && text === String(row.units)) return;
    const units = text === "" ? null : Number(text);
    // Same number as the one set by the team: nothing to save. A guessed number that is
    // typed again becomes the team's value.
    if (units === row.units && !row.guessed) return;
    start(async () => {
      const result = await setVariantUnitsAction({ productId, ids: row.ids, units });
      setError(result.ok ? null : (result.error ?? t("error")));
      if (result.ok) router.refresh();
    });
  };

  const names = row.labels.length > 0 ? row.labels.slice(0, 2).join(", ") : t("unnamed");
  const more = row.labels.length > 2 ? row.labels.length - 2 : 0;
  const share = row.decision.costShare;
  return (
    <tr>
      <td className="py-2 pr-3">
        {names}
        {more > 0 ? <span className="text-xs text-[var(--muted)]"> {t("more", { count: more })}</span> : null}
      </td>
      <td className="py-2 pr-3">
        <input
          type="number"
          min={1}
          max={500}
          inputMode="numeric"
          value={value}
          disabled={pending}
          aria-label={t("piecesOf", { name: names })}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => save()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save(true);
            }
          }}
          className="vs-input w-20 py-1.5 text-sm"
        />
        {row.guessed ? <span className="ml-2 text-[11px] text-[var(--muted)]">{t("guessed")}</span> : null}
        {error ? <span className="ml-2 text-[11px] text-[var(--rust-ink)]">{error}</span> : null}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{row.price == null ? "—" : row.price.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">
        {row.cogs == null ? "—" : `${row.cogs.toFixed(2)} €`}
        {row.weightG != null ? (
          <span className="block text-[11px] text-[var(--muted)]">{row.weightG} g</span>
        ) : null}
      </td>
      <td className="py-2">
        {row.decision.costLevel && share != null ? (
          <span
            className={`inline-block rounded-lg px-2.5 py-1 text-xs font-semibold ${tone[row.decision.costLevel]}`}
          >
            {t(`level.${row.decision.costLevel}`, { share: `${Math.round(share * 100)} %` })}
          </span>
        ) : (
          <span className="text-xs text-[var(--muted)]">{t("noVerdict")}</span>
        )}
      </td>
    </tr>
  );
}
