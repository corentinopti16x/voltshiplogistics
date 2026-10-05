import { getLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";
import { getAuthContext } from "@/lib/auth/context";
import { MarginAccessError } from "@/lib/pricing/margin-server";
import { listAdjustments, listFixedCosts } from "@/lib/finance/weekly";
import { fixedCostsForWeek, isoWeekNumber, parisDateOf, weekStartOf, WEEKS_PER_MONTH } from "@/lib/finance/weeks";
import { formatAmount, formatDate } from "@/lib/format";
import { ConfidentialTag, KpiTile, SignedAmount } from "@/components/admin/margin-ui";
import {
  AdjustmentForm,
  DeleteAdjustmentButton,
  DeleteFixedCostButton,
  FixedCostForm,
} from "@/components/admin/finance-forms";

// Confidential: voltship_admin only.
export const dynamic = "force-dynamic";

export default async function AdminFinanceCostsPage() {
  const [t, rawLocale, ctx] = await Promise.all([getTranslations("admin.finance"), getLocale(), getAuthContext()]);
  const locale = rawLocale === "fr" ? "fr" : "en";
  if (!ctx || ctx.role !== "voltship_admin") {
    redirect({ href: "/home", locale });
    return null;
  }
  let fixedCosts, adjustments;
  try {
    [fixedCosts, adjustments] = await Promise.all([listFixedCosts(), listAdjustments()]);
  } catch (error) {
    if (error instanceof MarginAccessError) {
      redirect({ href: "/home", locale });
      return null;
    }
    throw error;
  }
  const now = new Date();
  const today = parisDateOf(now);
  const currentWeek = weekStartOf(now);
  const thisWeek = fixedCostsForWeek(fixedCosts, currentWeek);
  const eur = (value: number | null | undefined) => formatAmount(value, locale);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">{t("kicker")}</p>
        <ConfidentialTag />
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">{t("costs.title")}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{t("costs.lead")}</p>
        </div>
        <Link href="/admin/finance" className="rounded-full border border-[var(--line)] px-4 py-2 text-sm hover:bg-white">
          {t("costs.backToWeeks")}
        </Link>
      </div>

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <KpiTile label={t("costs.thisWeek")} value={eur(thisWeek.total)} sub={t("costs.thisWeekSub", { week: isoWeekNumber(currentWeek) })} tone="gold" />
        <KpiTile label={t("costs.perMonth")} value={eur(thisWeek.total / WEEKS_PER_MONTH)} sub={t("costs.perMonthSub")} />
        <KpiTile label={t("costs.count")} value={fixedCosts.length} />
      </section>

      <section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">{t("costs.addTitle")}</h2>
        <p className="mt-1 mb-4 text-xs text-[var(--muted)]">{t("costs.addLead")}</p>
        <FixedCostForm today={today} />
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <div className="p-6">
          <h2 className="text-sm font-semibold">{t("costs.listTitle")}</h2>
        </div>
        {fixedCosts.length === 0 ? (
          <p className="border-t border-[var(--line)] p-6 text-sm text-[var(--muted)]">{t("costs.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-y border-[var(--line)] text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">{t("forms.label")}</th>
                  <th className="px-4 py-3">{t("forms.category")}</th>
                  <th className="px-4 py-3 text-right">{t("forms.amount")}</th>
                  <th className="px-4 py-3">{t("forms.period")}</th>
                  <th className="px-4 py-3 text-right">{t("costs.weekly")}</th>
                  <th className="px-4 py-3">{t("costs.validity")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {fixedCosts.map((cost) => {
                  const weekly =
                    cost.period === "monthly" ? cost.amountEur * WEEKS_PER_MONTH : cost.period === "weekly" ? cost.amountEur : null;
                  const active = cost.endDate == null || cost.endDate >= currentWeek;
                  return (
                    <tr key={cost.id} className={`border-b border-[var(--line)] ${active ? "" : "text-[var(--faint)]"}`}>
                      <td className="px-4 py-3">
                        <span className="font-medium">{cost.label}</span>
                        {cost.notes ? <span className="block text-xs text-[var(--muted)]">{cost.notes}</span> : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="grey">{t(`categories.${cost.category}`)}</Badge>
                      </td>
                      <td className="tabular px-4 py-3 text-right">{eur(cost.amountEur)}</td>
                      <td className="px-4 py-3 text-xs">{t(`periods.${cost.period}`)}</td>
                      <td className="tabular px-4 py-3 text-right">{weekly == null ? "—" : eur(weekly)}</td>
                      <td className="px-4 py-3 text-xs">
                        {formatDate(cost.startDate, locale)} → {cost.endDate ? formatDate(cost.endDate, locale) : "∞"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DeleteFixedCostButton id={cost.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">{t("adjustments.addTitle")}</h2>
        <p className="mt-1 mb-4 text-xs text-[var(--muted)]">{t("adjustments.addLead")}</p>
        <AdjustmentForm today={today} />
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <div className="p-6">
          <h2 className="text-sm font-semibold">{t("adjustments.listTitle")}</h2>
        </div>
        {adjustments.length === 0 ? (
          <p className="border-t border-[var(--line)] p-6 text-sm text-[var(--muted)]">{t("adjustments.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-y border-[var(--line)] text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">{t("table.week")}</th>
                  <th className="px-4 py-3">{t("forms.label")}</th>
                  <th className="px-4 py-3">{t("forms.kind")}</th>
                  <th className="px-4 py-3 text-right">{t("forms.amount")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {adjustments.map((adjustment) => (
                  <tr key={adjustment.id} className="border-b border-[var(--line)]">
                    <td className="px-4 py-3">
                      <Link href={`/admin/finance?week=${adjustment.weekStart}`} className="font-medium hover:underline">
                        S{isoWeekNumber(adjustment.weekStart)}
                      </Link>
                      <span className="ml-2 text-xs text-[var(--muted)]">{formatDate(adjustment.weekStart, locale)}</span>
                    </td>
                    <td className="px-4 py-3">
                      {adjustment.label}
                      {adjustment.notes ? <span className="block text-xs text-[var(--muted)]">{adjustment.notes}</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={adjustment.kind === "revenue" ? "green" : "rust"}>{t(`kinds.${adjustment.kind}`)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <SignedAmount value={adjustment.amountEur} locale={locale} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DeleteAdjustmentButton id={adjustment.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
