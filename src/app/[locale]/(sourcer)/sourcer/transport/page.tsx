import { getLocale, getTranslations } from "next-intl/server";
import { OperationsTabs } from "@/components/admin/section-tabs";
import { SourcerShell } from "@/components/sourcer/sourcer-shell";
import { Link, redirect } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { formatNumber } from "@/lib/format";
import { loadTransportOverview } from "@/lib/pricing/transport-server";
import { TRANSPORT_SAMPLE_WEIGHTS_G } from "@/lib/pricing/transport-view";

export const dynamic = "force-dynamic";

function weightLabel(weightG: number) {
  return weightG >= 1000 ? `${weightG / 1000} kg` : `${weightG} g`;
}

/** Country name in the page language ("US" → "États-Unis"); the code when the runtime has none. */
function countryName(code: string, locale: string) {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Voltship team page (sourcer + admin). The carrier costs are INTERNAL: only an admin gets
 * the amounts; the rest of the team sees which line is the cheapest at each weight.
 */
export default async function TransportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ c?: string; ch?: string }>;
}) {
  const { locale: routeLocale } = await params;
  const loc = routeLocale === "fr" ? "fr" : "en";
  const ctx = await getAuthContext();
  if (!ctx) {
    redirect({ href: "/staff/login", locale: loc });
    return null;
  }
  if (ctx.role !== "sourcer" && ctx.role !== "voltship_admin") {
    redirect({ href: "/home", locale: loc });
    return null;
  }
  const isAdmin = ctx.role === "voltship_admin";
  const [{ c, ch }, rawLocale, t, tChannels] = await Promise.all([
    searchParams,
    getLocale(),
    getTranslations("admin.transportPage"),
    getTranslations("admin.pricingForms.channels"),
  ]);
  const locale = rawLocale === "fr" ? "fr" : rawLocale === "zh" ? "zh" : "en";
  const overview = await loadTransportOverview(c, ch, { withCosts: isAdmin });
  const { destination, channel, lines } = overview;
  const href = (country: string, kind: string) =>
    `/sourcer/transport?c=${country}&ch=${kind}`;
  const pill = (selected: boolean) =>
    `rounded-full px-4 py-1.5 text-sm ${selected ? "bg-[var(--navy)] font-semibold text-white" : "bg-[var(--card)] text-[var(--ink)] ring-1 ring-[var(--line)] hover:ring-[var(--navy)]"}`;
  const segment = (selected: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm ${selected ? "bg-[var(--card)] font-semibold text-[var(--ink)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]"}`;

  return (
    <SourcerShell role={ctx.role}>
      <div className="flex flex-col gap-6">
        {isAdmin ? <OperationsTabs active="transport" /> : null}
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">
            {t("kicker")}
          </p>
          <h1 className="font-display mt-2 text-3xl">{t("title")}</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
            {t("lead")}
          </p>
        </div>

        {!overview.gridVersion || !destination ? (
          <p className="rounded-xl bg-[var(--rust-soft)] px-4 py-3 text-sm text-[var(--rust-ink)]">
            {t("noGrid")}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {overview.destinations.map((item) => (
                <Link
                  key={item.code}
                  href={href(item.code, channel)}
                  className={pill(item.code === destination)}
                >
                  {countryName(item.code, locale)}
                  <span className="ml-1.5 text-xs opacity-70">
                    {item.lines}
                  </span>
                </Link>
              ))}
            </div>
            <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-[var(--line)]/60 p-1">
              {overview.channels.map((item) => (
                <Link
                  key={item}
                  href={href(destination, item)}
                  className={segment(item === channel)}
                >
                  {tChannels(item)}
                </Link>
              ))}
            </div>

            <section className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)]">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--muted)]">
                    <th className="px-5 py-3 font-medium">{t("table.line")}</th>
                    {TRANSPORT_SAMPLE_WEIGHTS_G.map((weight) => (
                      <th
                        key={weight}
                        className="px-3 py-3 text-right font-medium"
                      >
                        {weightLabel(weight)}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-right font-medium">
                      {t("table.delivery")}
                    </th>
                    <th className="px-5 py-3 font-medium">
                      {t("table.eccang")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td
                        colSpan={TRANSPORT_SAMPLE_WEIGHTS_G.length + 3}
                        className="px-5 py-6 text-[var(--muted)]"
                      >
                        {t("empty")}
                      </td>
                    </tr>
                  ) : null}
                  {lines.map((line) => (
                    <tr
                      key={line.key}
                      className="border-t border-[var(--line)] align-top"
                    >
                      <td className="px-5 py-4">
                        <p>
                          <span className="text-base font-bold">
                            {line.carrier}
                          </span>
                          {line.lineName ? (
                            <span className="ml-2 font-medium">
                              {line.lineName}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {t("accepts", {
                            list: line.channels
                              .map((item) => tChannels(item))
                              .join(", "),
                          })}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          {t("weightRange", {
                            min: formatNumber(line.minG, locale),
                            max: formatNumber(line.maxG, locale),
                          })}
                          {line.iossRequired ? ` · ${t("ioss")}` : ""}
                        </p>
                      </td>
                      {line.samples.map((sample) => (
                        <td
                          key={sample.weightG}
                          className="px-3 py-4 text-right tabular-nums"
                        >
                          {!sample.available ? (
                            <span className="text-[var(--muted)]">—</span>
                          ) : sample.costRmb == null ? (
                            sample.cheapest ? (
                              <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                                {t("cheapest")}
                              </span>
                            ) : (
                              <span className="text-[var(--muted)]">
                                {t("available")}
                              </span>
                            )
                          ) : (
                            <span
                              className={
                                sample.cheapest
                                  ? "rounded-md bg-emerald-50 px-2 py-1 font-bold text-emerald-700"
                                  : "px-2 py-1"
                              }
                            >
                              {formatNumber(sample.costRmb, locale, 1)}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-4 text-right whitespace-nowrap">
                        {line.deliveryRange ? (
                          t("days", { range: line.deliveryRange })
                        ) : (
                          <span className="text-[var(--muted)]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {line.eccangMethod ? (
                          <span className="font-semibold text-emerald-700">
                            {line.eccangMethod}
                          </span>
                        ) : (
                          <span className="font-semibold text-[var(--rust-ink)]">
                            {t("notLinked")}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <p className="text-xs text-[var(--muted)]">
              {t(isAdmin ? "legend" : "legendTeam", {
                grid: overview.gridVersion,
              })}
            </p>
          </>
        )}
      </div>
    </SourcerShell>
  );
}
