import { useTranslations } from "next-intl";
import type { SalesTrend } from "@/lib/products/sales90";

/**
 * « 12 ventes / 7 j ▲ +20 % » — what the product sold this week, so the sourcer knows
 * what to fill in first. Grey when nothing sold in the last 14 days.
 */
export function SalesTrendBadge({ trend, locale, size = "sm" }: { trend: SalesTrend | undefined; locale: string; size?: "sm" | "lg" }) {
  const t = useTranslations("sourcer.sales7");
  const quiet = !trend || (trend.last7 === 0 && trend.previous7 === 0);
  const up = trend?.pct != null && trend.pct > 0;
  const down = trend?.pct != null && trend.pct < 0;
  const tone = quiet
    ? "bg-[var(--card-soft)] text-[var(--muted)] ring-[var(--line)]"
    : trend?.isNew || up
      ? "bg-[#e7f5ec] text-[#1f7a3d] ring-[#bfe3cb]"
      : down
        ? "bg-[#fdecea] text-[#b42318] ring-[#f5c2bb]"
        : "bg-[var(--card-soft)] text-[var(--ink)] ring-[var(--line)]";
  const pad = size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]";
  const delta = quiet
    ? null
    : trend!.isNew
      ? t("new")
      : trend!.pct == null
        ? null
        : `${up ? "▲ +" : down ? "▼ " : "= "}${trend!.pct} %`;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 tabular-nums ${pad} ${tone}`}
      title={quiet ? t("noneHint") : t("hint", { previous: trend!.previous7 })}
    >
      {quiet ? t("none") : t("last7", { count: trend!.last7.toLocaleString(locale) })}
      {delta ? <span className="font-semibold">{delta}</span> : null}
    </span>
  );
}
