import { getLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";
import { getAuthContext } from "@/lib/auth/context";
import { MarginAccessError } from "@/lib/pricing/margin-server";
import { FINANCE_WEEKS, loadWeeklyFinance, type WeeklyFinance } from "@/lib/finance/weekly";
import { isValidDateString, weekStartOfDate, type FinanceWeek } from "@/lib/finance/weeks";
import { formatAmount, formatDate, formatNumber } from "@/lib/format";
import { ConfidentialTag, KpiTile, SignedAmount } from "@/components/admin/margin-ui";
import { WeeklyResultChart } from "@/components/admin/finance-chart";

// Confidential: voltship_admin only (admin layout + loader both enforce it).
export const dynamic = "force-dynamic";

export default async function AdminFinancePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; recompute?: string }>;
}) {
  const [t, rawLocale, ctx, params] = await Promise.all([
    getTranslations("admin.finance"),
    getLocale(),
    getAuthContext(),
    searchParams,
  ]);
  const locale = rawLocale === "fr" ? "fr" : "en";
  if (!ctx || ctx.role !== "voltship_admin") {
    redirect({ href: "/home", locale });
    return null;
  }
  let data: WeeklyFinance;
  try {
    data = await loadWeeklyFinance({ count: FINANCE_WEEKS, recompute: params.recompute === "1" });
  } catch (error) {
    if (error instanceof MarginAccessError) {
      redirect({ href: "/home", locale });
      return null;
    }
    throw error;
  }

  const current = data.weeks[data.weeks.length - 1];
  const requested = params.week && isValidDateString(params.week) ? weekStartOfDate(params.week) : null;
  const selected = data.weeks.find((week) => week.weekStart === requested) ?? current;
  const eur = (value: number | null | undefined) => formatAmount(value, locale);
  const num = (value: number | null | undefined, digits = 0) => formatNumber(value, locale, digits);
  const weekLabel = (week: FinanceWeek) =>
    `S${week.isoWeek} · ${formatDate(week.weekStart, locale)} → ${formatDate(week.weekEnd, locale)}`;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">{t("kicker")}</p>
        <ConfidentialTag />
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{t("lead", { weeks: FINANCE_WEEKS })}</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/admin/finance/costs" className="rounded-full border border-[var(--line)] px-4 py-2 hover:bg-white">
            {t("manageCosts")}
          </Link>
          <Link href="/admin/finance?recompute=1" className="text-xs text-[var(--muted)] underline">
            {t("recompute")}
          </Link>
        </div>
      </div>
      <p className="mt-2 text-xs text-[var(--faint)]">{t("formula")}</p>

      {/* Current week KPIs */}
      <h2 className="mt-8 text-sm font-semibold">
        {t("currentWeek")} · {weekLabel(current)}{" "}
        {current.estimated ? <Badge tone="gold">{t("estimated")}</Badge> : null}
      </h2>
      <section className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiTile
          label={t("kpi.parcels")}
          value={num(current.parcels)}
          sub={current.parcels > current.pricedParcels ? t("kpi.unpriced", { count: current.parcels - current.pricedParcels }) : undefined}
        />
        <KpiTile label={t("kpi.revenue")} value={eur(current.revenue.total)} />
        <KpiTile
          label={t("kpi.grossMargin")}
          value={<SignedAmount value={current.grossMargin} locale={locale} />}
          sub={current.marginPerParcel != null ? t("kpi.perParcel", { amount: eur(current.marginPerParcel) }) : undefined}
        />
        <KpiTile label={t("kpi.fixed")} value={eur(current.fixedCosts.total)} />
        <KpiTile label={t("kpi.result")} value={<SignedAmount value={current.result} locale={locale} bold />} tone="gold" />
        <KpiTile
          label={t("kpi.breakEven")}
          value={current.breakEven.perDay != null ? num(current.breakEven.perDay, 1) : "—"}
          sub={
            current.breakEven.parcelsPerWeek != null
              ? t("kpi.breakEvenSub", {
                  week: num(current.breakEven.parcelsPerWeek, 1),
                  working: num(current.breakEven.perWorkingDay, 1),
                })
              : t("kpi.breakEvenNone")
          }
        />
      </section>

      {/* Chart */}
      <section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">{t("chart.title")}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">{t("chart.lead")}</p>
        <div className="mt-4">
          <WeeklyResultChart weeks={data.weeks} locale={locale} title={t("chart.title")} selected={selected.weekStart} />
        </div>
      </section>

      {/* 12-week table */}
      <section className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <div className="p-6">
          <h2 className="text-sm font-semibold">{t("table.title", { weeks: FINANCE_WEEKS })}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{t("table.lead")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-y border-[var(--line)] text-xs text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">{t("table.week")}</th>
                <th className="px-4 py-3 text-right">{t("table.parcels")}</th>
                <th className="px-4 py-3 text-right">{t("table.revenue")}</th>
                <th className="px-4 py-3 text-right">{t("table.variable")}</th>
                <th className="px-4 py-3 text-right">{t("table.grossMargin")}</th>
                <th className="px-4 py-3 text-right">{t("table.fixed")}</th>
                <th className="px-4 py-3 text-right">{t("table.result")}</th>
                <th className="px-4 py-3 text-right">{t("table.perParcel")}</th>
                <th className="px-4 py-3">{t("table.source")}</th>
              </tr>
            </thead>
            <tbody>
              {[...data.weeks].reverse().map((week) => {
                const isSelected = week.weekStart === selected.weekStart;
                return (
                  <tr key={week.weekStart} className={`border-b border-[var(--line)] ${isSelected ? "bg-[#fbf5df]" : ""}`}>
                    <td className="px-4 py-3">
                      <Link href={`/admin/finance?week=${week.weekStart}`} className="font-medium hover:underline">
                        S{week.isoWeek}
                      </Link>
                      <span className="ml-2 text-xs text-[var(--muted)]">{formatDate(week.weekStart, locale)}</span>
                      {week.weekStart === current.weekStart ? (
                        <span className="ml-2 text-xs text-[var(--gold)]">{t("table.current")}</span>
                      ) : null}
                    </td>
                    <td className="tabular px-4 py-3 text-right">{num(week.parcels)}</td>
                    <td className="tabular px-4 py-3 text-right">{eur(week.revenue.total)}</td>
                    <td className="tabular px-4 py-3 text-right">{eur(week.variableCosts.total)}</td>
                    <td className="px-4 py-3 text-right">
                      <SignedAmount value={week.grossMargin} locale={locale} />
                    </td>
                    <td className="tabular px-4 py-3 text-right">{eur(week.fixedCosts.total)}</td>
                    <td className="px-4 py-3 text-right">
                      <SignedAmount value={week.result} locale={locale} bold />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <SignedAmount value={week.marginPerParcel} locale={locale} />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {week.source === "none" ? (
                        <Badge tone="grey">{t("source.none")}</Badge>
                      ) : week.estimated ? (
                        <Badge tone="gold">{t("estimated")}</Badge>
                      ) : (
                        <Badge tone="green">{t("source.real")}</Badge>
                      )}
                      {data.cachedWeeks.includes(week.weekStart) ? (
                        <span className="ml-2 text-[var(--faint)]">{t("source.cached")}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-client breakdown for the selected week */}
      <section className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <div className="p-6">
          <h2 className="text-sm font-semibold">
            {t("byClient.title")} · {weekLabel(selected)}
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {t("byClient.lead")}
            {selected.revenue.adjustments !== 0 || selected.variableCosts.adjustments !== 0
              ? ` ${t("byClient.adjustments", {
                  revenue: eur(selected.revenue.adjustments),
                  cost: eur(selected.variableCosts.adjustments),
                })}`
              : ""}
          </p>
        </div>
        {selected.byClient.length === 0 ? (
          <p className="border-t border-[var(--line)] p-6 text-sm text-[var(--muted)]">{t("byClient.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-y border-[var(--line)] text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">{t("byClient.client")}</th>
                  <th className="px-4 py-3 text-right">{t("table.parcels")}</th>
                  <th className="px-4 py-3 text-right">{t("table.revenue")}</th>
                  <th className="px-4 py-3 text-right">{t("table.variable")}</th>
                  <th className="px-4 py-3 text-right">{t("table.grossMargin")}</th>
                  <th className="px-4 py-3 text-right">{t("byClient.share")}</th>
                </tr>
              </thead>
              <tbody>
                {selected.byClient.map((row) => (
                  <tr key={row.clientId} className="border-b border-[var(--line)]">
                    <td className="px-4 py-3">
                      <Link href={`/admin/clients/${row.clientId}#margin`} className="font-medium hover:underline">
                        {row.clientName}
                      </Link>
                    </td>
                    <td className="tabular px-4 py-3 text-right">
                      {num(row.parcels)}
                      {row.unpriced > 0 ? (
                        <span className="ml-1 text-xs text-[var(--rust-ink)]">({t("kpi.unpriced", { count: row.unpriced })})</span>
                      ) : null}
                    </td>
                    <td className="tabular px-4 py-3 text-right">{eur(row.revenue)}</td>
                    <td className="tabular px-4 py-3 text-right">{eur(row.cost)}</td>
                    <td className="px-4 py-3 text-right">
                      <SignedAmount value={row.margin} locale={locale} bold />
                    </td>
                    <td className="tabular px-4 py-3 text-right">
                      {selected.parcels > 0 ? `${num((row.parcels / selected.parcels) * 100)} %` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-[var(--faint)]">{t("caveat")}</p>
    </div>
  );
}
