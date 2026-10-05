import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { formatAmount } from "@/lib/format";
import type { ClientMargin } from "@/lib/pricing/margin-server";
import { ConfidentialTag, MarginFlags, Pct, SignedAmount, SourceLabel } from "@/components/admin/margin-ui";

/**
 * "Marge Voltship" card of the admin client page — CONFIDENTIAL. Server component,
 * rendered only under the admin layout; the data comes from `loadClientMargin`
 * which throws for any non-admin session.
 */
export async function ClientMarginCard({ data }: { data: ClientMargin }) {
  const [t, locale] = await Promise.all([getTranslations("admin.margin"), getLocale()]);
  const eur = (value: number | null | undefined) => formatAmount(value, locale);
  const { rows, totals, windowDays } = data;

  return (
    <section id="margin" className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
      <div className="p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">{t("clientCard.title")}</h2>
          <ConfidentialTag />
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("clientCard.lead")}</p>
        {!data.activeGridVersion ? (
          <p className="mt-2 text-xs text-[var(--rust-ink)]">{t("clientCard.noGrid")}</p>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="border-t border-[var(--line)] p-6 text-sm text-[var(--muted)]">{t("clientCard.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-y border-[var(--line)] text-xs text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">{t("clientCard.product")}</th>
                <th className="px-4 py-3">{t("clientCard.market")}</th>
                <th className="px-4 py-3 text-right">{t("clientCard.clientCogs")}</th>
                <th className="px-4 py-3 text-right">{t("clientCard.cost")}</th>
                <th className="px-4 py-3 text-right">{t("clientCard.margin")}</th>
                <th className="px-4 py-3 text-right">%</th>
                <th className="px-4 py-3 text-right">{t("clientCard.units", { days: windowDays })}</th>
                <th className="px-4 py-3">{t("clientCard.flags")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const m = row.margin;
                const noRate = m.flags.includes("no_rate");
                return (
                  <tr key={row.product.id} className="border-b border-[var(--line)]">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/margin/products/${row.product.id}`}
                        className="block max-w-[260px] truncate font-medium hover:underline"
                        title={t("clientCard.matrix")}
                      >
                        {row.product.title}
                      </Link>
                      <span className="text-xs text-[var(--muted)]">{row.product.sku ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3">{row.market}</td>
                    <td className="tabular px-4 py-3 text-right">{noRate ? "—" : eur(m.clientPays.total)}</td>
                    <td className="tabular px-4 py-3 text-right">
                      {noRate ? "—" : eur(m.costs.total)}
                      {!noRate && !m.complete ? (
                        <span className="ml-1 text-[11px] text-[var(--muted)]">{t("flags.partial")}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {noRate ? "—" : <SignedAmount value={m.margin.total} locale={locale} bold />}
                    </td>
                    <td className="px-4 py-3 text-right">{noRate ? "—" : <Pct value={m.margin.pct} locale={locale} />}</td>
                    <td className="tabular px-4 py-3 text-right">{row.unitsSold}</td>
                    <td className="px-4 py-3 text-xs">
                      <MarginFlags margin={m} compact />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-[var(--card-soft)] text-sm">
              <tr>
                <td className="px-4 py-3 font-semibold" colSpan={2}>
                  {t("clientCard.total")}
                  <span className="block text-[11px] font-normal text-[var(--muted)]">
                    {data.weightedBySales
                      ? t("clientCard.weightedBySales", { days: windowDays })
                      : t("clientCard.perUnit", { days: windowDays })}
                  </span>
                </td>
                <td className="tabular px-4 py-3 text-right font-semibold">{eur(totals.revenue)}</td>
                <td className="tabular px-4 py-3 text-right font-semibold">{eur(totals.cost)}</td>
                <td className="px-4 py-3 text-right">
                  <SignedAmount value={totals.margin} locale={locale} bold />
                </td>
                <td className="px-4 py-3 text-right">
                  <Pct value={totals.pct} locale={locale} />
                </td>
                <td className="tabular px-4 py-3 text-right font-semibold">{Math.round(totals.weight)}</td>
                <td className="px-4 py-3 text-xs">
                  <SourceLabel totals={totals} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
