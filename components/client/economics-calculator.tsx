"use client";

import { formatAmount } from "@/lib/format";
import { useActionState, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  computeEconomics,
  formatMetric,
  multiplierTone,
  type FinancialProfile,
} from "@/lib/domain/economics";
import { updateSellingPriceAction } from "@/app/actions/client";
import type { ActionResult } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";

const initial: ActionResult = { ok: false };

export function EconomicsCalculator({
  productId,
  initialPrice,
  cogs,
  profile,
}: {
  productId: string;
  initialPrice: number | null;
  cogs: number | null;
  profile: FinancialProfile;
}) {
  const locale = useLocale();
  const t = useTranslations("economics");
  const [price, setPrice] = useState(initialPrice?.toString() ?? "");
  const [state, action, pending] = useActionState(updateSellingPriceAction, initial);
  const selling = Number(price);

  const result = useMemo(
    () => computeEconomics(Number.isFinite(selling) ? selling : 0, cogs, profile),
    [selling, cogs, profile],
  );

  const tone = multiplierTone(result.multiplier);
  const toneClass =
    tone === "red"
      ? "text-[var(--rust-ink)]"
      : tone === "orange"
        ? "text-[#9A5B16]"
        : tone === "green"
          ? "text-[var(--green-ink)]"
          : "text-[var(--muted)]";
  const feePct = profile.psp_pct + profile.urssaf_pct + profile.vat_pct + profile.other_pct;

  return (
    <section className="vs-card p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[19px] font-bold">{t("title")}</h2>
        <p className="text-[12px] text-[var(--muted)]">{t("disclaimer")}</p>
      </div>
      <form action={action} className="mt-4 flex flex-wrap items-end gap-3 rounded-[14px] bg-[var(--card-soft)] p-4">
        <input type="hidden" name="product_id" value={productId} />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[12px] font-semibold text-[var(--muted)]">{t("sellingPrice")}</span>
          <input
            name="selling_price"
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="vs-input w-40 text-[18px] font-bold"
          />
        </label>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        {state.ok ? <p className="text-sm text-[var(--green-ink)]">{t("saved")}</p> : null}
        {state.error ? (
          <p className="text-sm text-[var(--rust-ink)]" role="alert">
            {state.error}
          </p>
        ) : null}
      </form>
      <dl className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Tile label={t("multiplier")} value={`×${formatMetric(result.multiplier)}`} className={toneClass} />
        <Tile label={t("profit")} value={formatAmount(result.profit, locale)} className={result.profit != null && result.profit < 0 ? "text-[var(--rust-ink)]" : ""} />
        <Tile label={t("roasBe")} value={formatMetric(result.roasBe)} />
        <Tile label={t("roasTarget")} value={formatMetric(result.roasTarget)} className="text-[var(--gold-text)]" />
        <Tile label={t("fees")} value={formatAmount(result.totalFees, locale)} />
        <Tile
          label={t("roasRange")}
          value={
            result.roasTargetLow == null
              ? "—"
              : `${formatMetric(result.roasTargetLow)} – ${formatMetric(result.roasTargetHigh)}`
          }
        />
        <Tile label={t("maxAtc")} value={formatMetric(result.maxAtc)} />
      </dl>
      <p className="mt-3 text-[12px] text-[var(--muted)]">
        {t("note", { fees: feePct, target: profile.target_margin_pct })}
      </p>
    </section>
  );
}

function Tile({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-[12px] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(16,40,74,0.06)] ring-1 ring-[var(--line-soft)]">
      <dt className="text-[12px] font-semibold text-[var(--muted)]">{label}</dt>
      <dd className={`font-display tabular text-[20px] font-extrabold ${className}`}>{value}</dd>
    </div>
  );
}
