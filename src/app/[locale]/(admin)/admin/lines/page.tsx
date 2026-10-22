import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { OperationsTabs } from "@/components/admin/section-tabs";
import { LineCheckButton, ZipCoverageForm } from "@/components/admin/zip-coverage-form";
import { deleteZipCoverageAction } from "@/app/actions/line-routing";
import { parseLineKey } from "@/lib/domain/carrier-rules";
import { readPricingSettings } from "@/lib/pricing/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { lineCheckOverview, listGridLines, listZipCoverage } from "@/lib/eccang/line-routing-server";
import { formatAmount, formatDate, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

/** "YunExpress|商派特惠带电 YTSPTHDD" → "YunExpress · 商派特惠带电 YTSPTHDD". */
function lineLabel(key: string | null) {
  if (!key) return "—";
  const ref = parseLineKey(key);
  if (!ref) return key;
  return ref.lineName ? `${ref.carrier} · ${ref.lineName}` : ref.carrier;
}

export default async function AdminLinesPage() {
  const [rawLocale, t, overview, coverage, gridLines, settings] = await Promise.all([
    getLocale(),
    getTranslations("admin.linesPage"),
    lineCheckOverview(7),
    listZipCoverage(),
    listGridLines().catch(() => []),
    readPricingSettings(createAdminClient()),
  ]);
  const locale = rawLocale === "fr" ? "fr" : rawLocale === "zh" ? "zh" : "en";
  const fx = settings.fx_rmb_per_eur > 0 ? settings.fx_rmb_per_eur : 7.5;
  const migrated = overview.migrated && coverage.migrated;
  const lineOptions = gridLines.map((line) => ({
    value: `${line.destination}||${line.carrier}||${line.lineName ?? ""}`,
    label: `${line.destination} · ${line.carrier}${line.lineName ? ` · ${line.lineName}` : ""}`,
  }));
  const autoCarriers = Object.entries(settings.auto_carriers)
    .map(([market, carriers]) => `${market} : ${carriers.join(", ")}`)
    .join(" · ");
  const tile = "rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4";

  return (
    <div className="flex flex-col gap-6">
      <OperationsTabs active="lines" />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">{t("kicker")}</p>
          <h1 className="font-display mt-2 text-3xl">{t("title")}</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">{t("lead")}</p>
        </div>
        <LineCheckButton />
      </div>

      {!migrated ? (
        <p className="rounded-xl bg-[var(--rust-soft)] px-4 py-3 text-sm text-[var(--rust-ink)]">{t("missingTable")}</p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={tile}>
          <p className="text-xs text-[var(--muted)]">{t("stats.checked", { days: overview.days })}</p>
          <p className="mt-1 text-2xl font-semibold">{formatNumber(overview.checked, locale)}</p>
        </div>
        <div className={tile}>
          <p className="text-xs text-[var(--muted)]">{t("stats.ok")}</p>
          <p className="mt-1 text-2xl font-semibold">{formatNumber(overview.ok, locale)}</p>
        </div>
        <div className={`${tile} ${overview.moreExpensive > 0 ? "border-[var(--rust-ink)]" : ""}`}>
          <p className="text-xs text-[var(--muted)]">{t("stats.moreExpensive")}</p>
          <p className="mt-1 text-2xl font-semibold">{formatNumber(overview.moreExpensive, locale)}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {t("stats.extra", {
              rmb: formatNumber(overview.extraRmb, locale, 2),
              eur: formatAmount(overview.extraRmb / fx, locale),
            })}
          </p>
          {overview.moreExpensiveOpen > 0 ? (
            <p className="mt-1 text-xs font-semibold text-[var(--rust-ink)]">
              {t("stats.open", { count: overview.moreExpensiveOpen })}
            </p>
          ) : null}
        </div>
        <div className={tile}>
          <p className="text-xs text-[var(--muted)]">{t("stats.unknown")}</p>
          <p className="mt-1 text-2xl font-semibold">{formatNumber(overview.unknownLine, locale)}</p>
        </div>
      </section>

      <p className="text-sm text-[var(--muted)]">
        {t("howItWorks")} {autoCarriers ? t("autoCarriers", { list: autoCarriers }) : null}
      </p>

      {overview.unmappedMethods.length > 0 ? (
        <section className="rounded-2xl border border-[var(--gold-soft)] bg-[var(--card)] p-5">
          <h2 className="text-sm font-semibold">{t("unmapped.title")}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{t("unmapped.lead")}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {overview.unmappedMethods.map((method) => (
              <li key={method.method}>
                <Badge tone="gold">
                  <span className="font-mono">{method.method}</span> · {formatNumber(method.orders, locale)}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
        <h2 className="text-sm font-semibold">{t("table.title")}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">{t("table.lead")}</p>
        {overview.rows.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">{t("table.empty")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-xs text-[var(--muted)]">
                <tr className="border-b border-[var(--line)]">
                  <th className="py-2 pr-3 font-medium">{t("table.order")}</th>
                  <th className="py-2 pr-3 font-medium">{t("table.client")}</th>
                  <th className="py-2 pr-3 font-medium">{t("table.zip")}</th>
                  <th className="py-2 pr-3 font-medium">{t("table.weight")}</th>
                  <th className="py-2 pr-3 font-medium">{t("table.actual")}</th>
                  <th className="py-2 pr-3 font-medium">{t("table.planned")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("table.extra")}</th>
                  <th className="py-2 font-medium">{t("table.status")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.rows.map((row) => (
                  <tr key={row.orderId} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-mono text-xs">{row.referenceNo}</span>
                      {row.externalRef ? <span className="block text-xs text-[var(--muted)]">{row.externalRef}</span> : null}
                    </td>
                    <td className="py-2 pr-3">{row.clientName ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {row.destination ?? ""} {row.zip ?? "—"}
                    </td>
                    <td className="py-2 pr-3">{row.weightG ? `${formatNumber(row.weightG, locale)} g` : "—"}</td>
                    <td className="py-2 pr-3">
                      {row.actualLine ? lineLabel(row.actualLine) : <span className="font-mono text-xs">{row.shippingMethod ?? "—"}</span>}
                    </td>
                    <td className="py-2 pr-3">
                      {lineLabel(row.plannedLine)}
                      {row.plannedMethod ? <span className="block font-mono text-xs text-[var(--muted)]">{row.plannedMethod}</span> : null}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {row.extraRmb != null && row.extraRmb !== 0 ? `${row.extraRmb > 0 ? "+" : ""}${formatNumber(row.extraRmb, locale, 2)} ¥` : "—"}
                    </td>
                    <td className="py-2">
                      <Badge tone={row.status === "more_expensive" ? "rust" : row.status === "cheaper" ? "green" : "grey"}>
                        {t(`status.${row.status}`)}
                      </Badge>
                      {row.open && row.status === "more_expensive" ? (
                        <span className="mt-1 block text-xs font-semibold text-[var(--rust-ink)]">{t("openHint")}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
        <h2 className="text-sm font-semibold">{t("coverage.title")}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">{t("coverage.lead")}</p>
        {coverage.rows.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">{t("coverage.empty")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--line)]">
            {coverage.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <Badge tone="navy">{row.destination}</Badge>
                <span className="font-medium">
                  {row.carrier}
                  {row.lineName ? ` · ${row.lineName}` : ""}
                </span>
                <Badge tone={row.mode === "only" ? "blue" : "gold"}>
                  {row.mode === "only" ? t("coverage.only", { count: row.count }) : t("coverage.except", { count: row.count })}
                </Badge>
                <span className="font-mono text-xs text-[var(--muted)]">
                  {row.sample.join(", ")}
                  {row.count > row.sample.length ? "…" : ""}
                </span>
                {row.note ? <span className="text-xs text-[var(--muted)]">« {row.note} »</span> : null}
                <span className="ml-auto text-xs text-[var(--muted)]">{formatDate(row.updatedAt, locale)}</span>
                <form action={deleteZipCoverageAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <button type="submit" className="cursor-pointer text-xs text-red-700 hover:underline">
                    {t("coverage.delete")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 border-t border-[var(--line)] pt-5">
          <ZipCoverageForm lines={lineOptions} />
        </div>
      </section>
    </div>
  );
}
