"use client";

import { useActionState, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  computeEconomics,
  formatMetric,
  multiplierTone,
  type FinancialProfile,
} from "@/lib/domain/economics";
import { updateSellingPriceAction } from "@/app/actions/client";
import type { ActionResult } from "@/app/actions/admin";

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
      ? "text-red-700"
      : tone === "orange"
        ? "text-orange-700"
        : tone === "green"
          ? "text-emerald-700"
          : "text-[var(--muted)]";

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
      <h2 className="text-sm font-semibold">{t("title")}</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">{t("disclaimer")}</p>
      <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="product_id" value={productId} />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[var(--muted)]">{t("sellingPrice")}</span>
          <input
            name="selling_price"
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-40 rounded-md border border-[var(--line)] bg-white px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded-md border border-[var(--line)] px-3 py-2 text-sm hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? t("saving") : t("save")}
        </button>
        {state.ok ? <p className="text-sm text-emerald-800">{t("saved")}</p> : null}
        {state.error ? (
          <p className="text-sm text-red-700" role="alert">
            {state.error}
          </p>
        ) : null}
      </form>
      <dl className="mt-5 grid gap-3 sm:grid-cols-2">
        <Row label={t("multiplier")} value={formatMetric(result.multiplier)} className={toneClass} />
        <Row label={t("fees")} value={formatMetric(result.totalFees)} />
        <Row label={t("profit")} value={formatMetric(result.profit)} />
        <Row label={t("roasBe")} value={formatMetric(result.roasBe)} />
        <Row label={t("roasTarget")} value={formatMetric(result.roasTarget)} />
        <Row
          label={t("roasRange")}
          value={
            result.roasTargetLow == null
              ? "—"
              : `${formatMetric(result.roasTargetLow)} – ${formatMetric(result.roasTargetHigh)}`
          }
        />
        <Row label={t("maxAtc")} value={formatMetric(result.maxAtc)} />
      </dl>
    </section>
  );
}

function Row({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] pb-2 text-sm">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className={`font-medium ${className ?? ""}`}>{value}</dd>
    </div>
  );
}
