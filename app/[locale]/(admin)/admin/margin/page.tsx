import { getLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { loadMarginSummary, MarginAccessError } from "@/lib/pricing/margin-server";
import { formatAmount } from "@/lib/format";
import { ConfidentialTag, KpiTile, Pct, SignedAmount, SourceLabel } from "@/components/admin/margin-ui";

// Confidential: voltship_admin only (the admin layout redirects everyone else; the
// loader throws for any other role as a second line of defence).
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

export default async function AdminMarginPage() {
  const [t, rawLocale, ctx] = await Promise.all([getTranslations("admin.margin"), getLocale(), getAuthContext()]);
  const locale = rawLocale === "fr" ? "fr" : "en";
  if (!ctx || ctx.role !== "voltship_admin") {
    redirect({ href: "/home", locale });
    return null;
  }
  let summary;
  try {
    summary = await loadMarginSummary(WINDOW_DAYS);
  } catch (error) {
    if (error instanceof MarginAccessError) {
      redirect({ href: "/home", locale });
      return null;
    }
    throw error;
  }
  const { totals, settings } = summary;
  const eur = (value: number | null | undefined) => formatAmount(value, locale);
  const parcels = totals.weight;
  const perParcel = parcels > 0 ? totals.margin / parcels : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">{t("kicker")}</p>
        <ConfidentialTag />
      </div>
      <h1 className="font-display mt-2 text-3xl">{t("title")}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">{t("lead", { days: WINDOW_DAYS })}</p>
      <p className="mt-1 text-xs text-[var(--faint)]">
        {t("formula", { fx: settings.fx_rmb_per_eur, fxMarket: settings.fx_market_rate })}
      </p>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiTile
          label={t("kpi.revenue", { days: WINDOW_DAYS })}
          value={eur(totals.revenue)}
          sub={t("kpi.orders", { count: summary.ordersShipped })}
        />
        <KpiTile label={t("kpi.cost")} value={eur(totals.cost)} sub={<SourceLabel totals={totals} />} />
        <KpiTile
          label={t("kpi.margin")}
          value={<SignedAmount value={totals.margin} locale={locale} />}
          sub={
            totals.incomplete > 0 ? t("kpi.partial", { count: Math.round(totals.incomplete) }) : undefined
          }
          tone="gold"
        />
        <KpiTile label={t("kpi.pct")} value={<Pct value={totals.pct} locale={locale} />} />
        <KpiTile
          label={t("kpi.perParcel")}
          value={<SignedAmount value={perParcel} locale={locale} />}
          sub={`${t("kpi.fx")} : ${eur(totals.fxGain)}`}
        />
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <KpiTile label={t("split.sourcing")} value={<SignedAmount value={totals.sourcing} locale={locale} />} />
        <KpiTile label={t("split.transport")} value={<SignedAmount value={totals.transport} locale={locale} />} />
        <KpiTile label={t("split.handling")} value={<SignedAmount value={totals.handling} locale={locale} />} />
      </section>

      <section className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <div className="p-6">
          <h2 className="text-sm font-semibold">{t("byClient.title")}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{t("byClient.lead")}</p>
        </div>
        {summary.byClient.length === 0 ? (
          <p className="border-t border-[var(--line)] p-6 text-sm text-[var(--muted)]">{t("byClient.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-y border-[var(--line)] text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">{t("byClient.client")}</th>
                  <th className="px-4 py-3 text-right">{t("byClient.orders")}</th>
                  <th className="px-4 py-3 text-right">{t("byClient.revenue")}</th>
                  <th className="px-4 py-3 text-right">{t("byClient.cost")}</th>
                  <th className="px-4 py-3 text-right">{t("byClient.margin")}</th>
                  <th className="px-4 py-3 text-right">{t("byClient.pct")}</th>
                  <th className="px-4 py-3">{t("byClient.source")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.byClient.map((row) => (
                  <tr key={row.clientId} className="border-b border-[var(--line)]">
                    <td className="px-4 py-3">
                      <Link href={`/admin/clients/${row.clientId}#margin`} className="font-medium hover:underline">
                        {row.clientName}
                      </Link>
                    </td>
                    <td className="tabular px-4 py-3 text-right">
                      {row.orders}
                      {row.unpriced > 0 ? (
                        <span className="ml-1 text-xs text-[var(--rust-ink)]">
                          ({t("byClient.unpriced", { count: row.unpriced })})
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular px-4 py-3 text-right">{eur(row.totals.revenue)}</td>
                    <td className="tabular px-4 py-3 text-right">{eur(row.totals.cost)}</td>
                    <td className="px-4 py-3 text-right">
                      <SignedAmount value={row.totals.margin} locale={locale} bold />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Pct value={row.totals.pct} locale={locale} />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <SourceLabel totals={row.totals} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-[var(--faint)]">
        {t("settingsNote", {
          handling: eur(settings.handling_cost_eur),
          fx: settings.fx_rmb_per_eur,
          fxMarket: settings.fx_market_rate,
        })}{" "}
        <Link href="/admin/pricing/update" className="underline">
          →
        </Link>
      </p>
    </div>
  );
}
