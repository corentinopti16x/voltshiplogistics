import { getLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import {
  loadAnnouncedPriceAlerts,
  loadEstimatedShopifyOrderMargins,
  loadMarginSummary,
  MarginAccessError,
  type OrderMargin,
} from "@/lib/pricing/margin-server";
import { formatAmount } from "@/lib/format";
import { ConfidentialTag, KpiTile, Pct, SignedAmount, SourceLabel } from "@/components/admin/margin-ui";
import { AnnouncedAlertsSection } from "@/components/admin/announced-alerts";

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
  let announced;
  try {
    [summary, announced] = await Promise.all([loadMarginSummary(WINDOW_DAYS), loadAnnouncedPriceAlerts()]);
  } catch (error) {
    if (error instanceof MarginAccessError) {
      redirect({ href: "/home", locale });
      return null;
    }
    throw error;
  }
  const { totals, settings } = summary;
  // Per-order view: shipped ECCANG parcels when there are some, otherwise an estimate
  // from the Shopify orders of the same window (no billed weight yet).
  let perOrder: OrderMargin[] = summary.orders;
  let perOrderEstimated = false;
  let estimatedNames = new Map<string, string>();
  if (perOrder.length === 0) {
    const today = new Date();
    const from = new Date(today.getTime() - (WINDOW_DAYS - 1) * 86400000);
    const estimated = await loadEstimatedShopifyOrderMargins({
      fromDate: from.toISOString().slice(0, 10),
      toDate: today.toISOString().slice(0, 10),
    }).catch(() => null);
    perOrder = estimated?.orders ?? [];
    estimatedNames = estimated?.clientNames ?? new Map();
    perOrderEstimated = true;
  }
  const perOrderRows = [...perOrder]
    .sort((a, b) => String(b.shippedAt ?? "").localeCompare(String(a.shippedAt ?? "")))
    .slice(0, 300);
  const perOrderPriced = perOrder.filter((order) => order.margin != null);
  const perOrderAvg =
    perOrderPriced.length > 0
      ? perOrderPriced.reduce((sum, order) => sum + (order.margin?.margin.total ?? 0), 0) / perOrderPriced.length
      : null;
  const eur = (value: number | null | undefined) => formatAmount(value, locale);
  const clientNames = new Map(summary.byClient.map((row) => [row.clientId, row.clientName]));
  const summaryClientName = (id: string) => clientNames.get(id) ?? estimatedNames.get(id) ?? "—";
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

      <AnnouncedAlertsSection rows={announced.rows} threshold={announced.threshold} locale={locale} />

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

      <section id="orders" className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <div className="flex flex-wrap items-end justify-between gap-3 p-6">
          <div>
            <h2 className="text-sm font-semibold">{t("byOrder.title")}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {perOrderEstimated ? t("byOrder.leadEstimated", { days: WINDOW_DAYS }) : t("byOrder.lead", { days: WINDOW_DAYS })}
            </p>
          </div>
          <div className="text-right text-xs text-[var(--muted)]">
            {t("byOrder.avg")}{" "}
            <span className="text-base font-bold text-[var(--ink)]">
              <SignedAmount value={perOrderAvg} locale={locale} />
            </span>
            <div>
              {t("byOrder.count", { priced: perOrderPriced.length, total: perOrder.length })}
            </div>
          </div>
        </div>
        {perOrderRows.length === 0 ? (
          <p className="border-t border-[var(--line)] p-6 text-sm text-[var(--muted)]">{t("byOrder.empty")}</p>
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="sticky top-0 border-y border-[var(--line)] bg-[var(--card)] text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">{t("byOrder.date")}</th>
                  <th className="px-4 py-3">{t("byOrder.client")}</th>
                  <th className="px-4 py-3">{t("byOrder.order")}</th>
                  <th className="px-4 py-3">{t("byOrder.shipping")}</th>
                  <th className="px-4 py-3">{t("byOrder.tracking")}</th>
                  <th className="px-4 py-3 text-right">{t("byOrder.units")}</th>
                  <th className="px-4 py-3 text-right">{t("byOrder.clientPays")}</th>
                  <th className="px-4 py-3 text-right">{t("byOrder.cost")}</th>
                  <th className="px-4 py-3 text-right">{t("split.sourcing")}</th>
                  <th className="px-4 py-3 text-right">{t("split.transport")}</th>
                  <th className="px-4 py-3 text-right">{t("split.handling")}</th>
                  <th className="px-4 py-3 text-right">{t("byOrder.margin")}</th>
                </tr>
              </thead>
              <tbody>
                {perOrderRows.map((order) => {
                  const m = order.margin;
                  return (
                    <tr key={order.orderId} className="border-b border-[var(--line)]">
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap text-[var(--muted)]">
                        {order.shippedAt ? new Date(order.shippedAt).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB") : "—"}
                      </td>
                      <td className="px-4 py-2.5">{summaryClientName(order.clientId)}</td>
                      <td className="px-4 py-2.5 font-medium">{order.label}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {order.shipping ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              order.shipping.status === "fulfilled"
                                ? "bg-[#e7f5ec] text-[#1f7a3d]"
                                : order.shipping.status === "partial"
                                  ? "bg-[#fff1d6] text-[#8a5a00]"
                                  : "bg-[var(--bg)] text-[var(--muted)] ring-1 ring-[var(--line)]"
                            }`}
                            title={order.shipping.source === "eccang" ? "ECCANG" : "Shopify"}
                          >
                            {t(`byOrder.statuses.${order.shipping.status}`)}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--faint)]">{t("byOrder.statuses.unknown")}</span>
                        )}
                        {order.shipping?.shippedAt ? (
                          <span className="block text-[11px] text-[var(--faint)]">
                            {new Date(order.shipping.shippedAt).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB")}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {order.shipping && order.shipping.trackingNumbers.length > 0 ? (
                          <>
                            {order.shipping.url ? (
                              <a
                                href={order.shipping.url}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono font-medium underline"
                              >
                                {order.shipping.trackingNumbers[0]}
                              </a>
                            ) : (
                              <span className="font-mono font-medium">{order.shipping.trackingNumbers[0]}</span>
                            )}
                            {order.shipping.trackingNumbers.length > 1 ? (
                              <span className="text-[var(--muted)]"> +{order.shipping.trackingNumbers.length - 1}</span>
                            ) : null}
                            {order.shipping.company ? (
                              <span className="block text-[11px] text-[var(--muted)]">{order.shipping.company}</span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-[var(--faint)]">—</span>
                        )}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right">
                        {order.lines.reduce((sum, line) => sum + line.quantity, 0)}
                      </td>
                      {m ? (
                        <>
                          <td className="tabular px-4 py-2.5 text-right">{eur(m.clientPays.total)}</td>
                          <td className="tabular px-4 py-2.5 text-right">{eur(m.costs.total)}</td>
                          <td className="px-4 py-2.5 text-right"><SignedAmount value={m.margin.sourcing} locale={locale} /></td>
                          <td className="px-4 py-2.5 text-right"><SignedAmount value={m.margin.transport} locale={locale} /></td>
                          <td className="px-4 py-2.5 text-right"><SignedAmount value={m.margin.handling} locale={locale} /></td>
                          <td className="px-4 py-2.5 text-right">
                            <SignedAmount value={m.margin.total} locale={locale} bold />
                          </td>
                        </>
                      ) : (
                        <td colSpan={6} className="px-4 py-2.5 text-right text-xs text-[var(--rust-ink)]">
                          {t("byOrder.unpriced")}{" "}
                          <Link href="/admin/todo" className="font-semibold underline">
                            {t("byOrder.toComplete")}
                          </Link>
                        </td>
                      )}
                    </tr>
                  );
                })}
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
