import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { formatAmount } from "@/lib/format";
import type { AnnouncedPriceAlert } from "@/lib/pricing/margin-server";
import { SignedAmount } from "@/components/admin/margin-ui";

const TONE: Record<AnnouncedPriceAlert["status"], string> = {
  loss: "bg-[#fde8e6] text-[#b42318]",
  low_margin: "bg-[#fde8e6] text-[#b42318]",
  expired: "bg-[#fff1d6] text-[#8a5a00]",
  expiring: "bg-[#fff1d6] text-[#8a5a00]",
  no_data: "bg-[var(--bg)] text-[var(--muted)]",
  ok: "bg-[#e7f5ec] text-[#1f7a3d]",
};

/** CONFIDENTIAL (admin Marge): locked « prix annoncés » checked against the live grid. */
export async function AnnouncedAlertsSection({
  rows,
  threshold,
  locale,
}: {
  rows: AnnouncedPriceAlert[];
  threshold: number;
  locale: "fr" | "en";
}) {
  const t = await getTranslations("admin.margin.announced");
  const eur = (value: number | null | undefined) => formatAmount(value, locale);
  const toWatch = rows.filter((row) => row.status !== "ok").length;
  return (
    <section
      id="announced"
      className={`mt-8 overflow-hidden rounded-2xl border bg-[var(--card)] ${
        rows.some((row) => row.status === "loss" || row.status === "low_margin") ? "border-[#f3b4ad]" : "border-[var(--line)]"
      }`}
    >
      <div className="p-6">
        <h2 className="text-sm font-semibold">
          {t("title")}
          {toWatch > 0 ? (
            <span className="ml-2 rounded-full bg-[#fde8e6] px-2 py-0.5 text-xs text-[#b42318]">{toWatch}</span>
          ) : null}
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">{t("lead", { threshold: eur(threshold) })}</p>
      </div>
      {rows.length === 0 ? (
        <p className="border-t border-[var(--line)] p-6 text-sm text-[var(--muted)]">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-y border-[var(--line)] text-xs text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">{t("product")}</th>
                <th className="px-4 py-3">{t("market")}</th>
                <th className="px-4 py-3 text-right">{t("locked")}</th>
                <th className="px-4 py-3 text-right">{t("rule")}</th>
                <th className="px-4 py-3 text-right">{t("margin")}</th>
                <th className="px-4 py-3">{t("until")}</th>
                <th className="px-4 py-3">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.productId}-${row.market}-${row.quantity}`} className="border-b border-[var(--line)]">
                  <td className="px-4 py-3">
                    <Link href={`/admin/margin/products/${row.productId}`} className="font-medium hover:underline">
                      {row.productTitle}
                    </Link>
                    <span className="block text-xs text-[var(--muted)]">{row.clientName}</span>
                  </td>
                  <td className="px-4 py-3">
                    {row.market} ×{row.quantity}
                  </td>
                  <td className="tabular px-4 py-3 text-right font-semibold">{eur(row.price)}</td>
                  <td className="tabular px-4 py-3 text-right text-[var(--muted)]">{eur(row.rulePrice)}</td>
                  <td className="px-4 py-3 text-right">
                    <SignedAmount value={row.margin} locale={locale} bold />
                  </td>
                  <td className="tabular px-4 py-3">{row.until ?? t("noDate")}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[row.status]}`}>
                      {t(`statuses.${row.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
