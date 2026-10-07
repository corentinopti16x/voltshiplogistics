"use client";

import { useTranslations } from "next-intl";
import { SIMPLE_PIPELINE, type LifecycleStatus } from "@/lib/products/types";

const LIFECYCLES: Array<LifecycleStatus | ""> = ["", "winning", "testing", "declining", "dead"];
const dotClass: Record<string, string> = {
  "": "bg-white",
  winning: "bg-[var(--gold-bright)]",
  testing: "bg-[var(--blue)]",
  declining: "bg-[var(--rust)]",
  dead: "bg-[#9AA8BA]",
};

export function ProductFilters({
  q,
  lifecycle,
  sourcing,
  sort,
  minSales,
  period,
  counts,
}: {
  q: string;
  lifecycle: string;
  sourcing: string;
  sort: string;
  minSales: string;
  period: number;
  counts: Record<"all" | LifecycleStatus, number> | Record<string, number>;
}) {
  const t = useTranslations("products");

  return (
    <form method="get" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("allLifecycle")}>
          {LIFECYCLES.map((value) => {
            const on = lifecycle === value;
            const count = counts[value === "" ? "all" : value] ?? 0;
            return (
              <button
                key={value || "all"}
                type="submit"
                name="lifecycle"
                value={value}
                aria-pressed={on}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition ${
                  on
                    ? "border-white bg-white text-[var(--navy)]"
                    : "border-white/25 bg-white/8 text-white hover:bg-white/15"
                }`}
              >
                <span
                  aria-hidden
                  className={`h-[7px] w-[7px] rounded-full ${value === "" ? (on ? "bg-[var(--navy)]" : "bg-white") : dotClass[value]}`}
                />
                {value === "" ? t("allLifecycle") : value.charAt(0).toUpperCase() + value.slice(1)}
                <span className="opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
        <label className="ml-auto flex min-w-[220px] flex-1 items-center gap-2 rounded-[12px] border border-white/25 bg-white/10 px-3 sm:flex-none">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(255,255,255,0.75)"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <span className="sr-only">{t("search")}</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t("search")}
            className="w-full bg-transparent py-2 text-[14px] text-white placeholder:text-white/60 focus:outline-none"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[12px] font-semibold text-white/80">
          {t("allSourcing")}
          <select
            name="sourcing"
            defaultValue={sourcing}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className="vs-input cursor-pointer !py-1.5 text-[13px]"
          >
            <option value="">{t("sourcingAny")}</option>
            <option value="open">{t("sourcingOpen")}</option>
            {SIMPLE_PIPELINE.map((stage) => (
              <option key={stage} value={stage}>
                {t(`simpleStage.${stage}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12px] font-semibold text-white/80">
          {t("periodLabel")}
          <select
            name="period"
            defaultValue={String(period)}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className="vs-input cursor-pointer !py-1.5 text-[13px]"
          >
            {[7, 30, 90].map((days) => (
              <option key={days} value={days}>
                {t("periodDays", { days })}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12px] font-semibold text-white/80">
          {t("sortLabel")}
          <select
            name="sort"
            defaultValue={sort}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className="vs-input cursor-pointer !py-1.5 text-[13px]"
          >
            {(["sales", "salesLow", "profit", "price", "newest", "name"] as const).map(
              (key) => (
                <option key={key} value={key}>
                  {t(`sort.${key}`)}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12px] font-semibold text-white/80">
          {t("minSalesLabel")}
          <input
            type="number"
            name="min"
            min={0}
            defaultValue={minSales}
            placeholder="0"
            className="vs-input w-20 !py-1.5 text-[13px]"
          />
        </label>
        <button
          type="submit"
          className="cursor-pointer rounded-[9px] border border-white/25 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-white/10"
        >
          {t("applyFilters")}
        </button>
      </div>
    </form>
  );
}
