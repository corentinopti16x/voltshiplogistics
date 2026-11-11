import { getLocale, getTranslations } from "next-intl/server";
import { OperationsTabs } from "@/components/admin/section-tabs";
import { SourcerShell } from "@/components/sourcer/sourcer-shell";
import { TransportTable } from "@/components/transport/transport-table";
import { Link, redirect } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { loadStoredLinePrices } from "@/lib/pricing/line-price-server";
import {
  loadCountriesOverview,
  loadTransportOverview,
} from "@/lib/pricing/transport-server";
import { TRANSPORT_CHANNELS } from "@/lib/pricing/transport-view";

export const dynamic = "force-dynamic";

/** Country name in the page language ("US" → "États-Unis"); the code when the runtime has none. */
function countryName(code: string, locale: string) {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Voltship team page (sourcer + admin): the team configures the transport, so it sees the
 * carrier costs in RMB. Client prices and margins are never shown here.
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
  const href = (country: string, kind: string) =>
    `/sourcer/transport?c=${country}&ch=${kind}`;
  const heading = (
    <>
      {isAdmin ? <OperationsTabs active="transport" /> : null}
      <div>
        <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">
          {t("kicker")}
        </p>
        <h1 className="font-display mt-2 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          {c ? t("lead") : t("all.lead")}
        </p>
      </div>
    </>
  );

  // No country asked: every country at once.
  if (!c) {
    const all = await loadCountriesOverview();
    const blocked = all.countries.filter((row) => row.blocked > 0).length;
    const unlinked = all.countries.reduce((sum, row) => sum + row.unlinked, 0);
    const noDelivery = all.countries.reduce(
      (sum, row) => sum + row.noDelivery,
      0,
    );
    return (
      <SourcerShell role={ctx.role}>
        <div className="flex flex-col gap-6">
          {heading}
          {!all.gridVersion ? (
            <p className="rounded-xl bg-[var(--rust-soft)] px-4 py-3 text-sm text-[var(--rust-ink)]">
              {t("noGrid")}
            </p>
          ) : (
            <>
              <p
                className={`w-fit rounded-xl px-4 py-2.5 text-sm font-medium ${
                  blocked > 0
                    ? "bg-[var(--rust-soft)] text-[var(--rust-ink)]"
                    : "bg-emerald-50 text-emerald-700"
                }`}
              >
                {blocked > 0
                  ? t("all.blockedSummary", { count: blocked })
                  : t("all.okSummary")}
                {unlinked > 0
                  ? ` · ${t("all.unlinked", { count: unlinked })}`
                  : ""}
                {noDelivery > 0
                  ? ` · ${t("all.noDelivery", { count: noDelivery })}`
                  : ""}
              </p>
              <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-[var(--muted)]">
                        <th className="px-5 py-3 font-medium">
                          {t("all.country")}
                        </th>
                        {TRANSPORT_CHANNELS.map((item) => (
                          <th key={item} className="px-3 py-3 font-medium">
                            {tChannels(item)}
                          </th>
                        ))}
                        <th className="px-5 py-3 font-medium">
                          {t("all.todo")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {all.countries.map((row) => {
                        const first =
                          row.cells.find((cell) => cell.blocked) ??
                          row.cells.find((cell) => cell.active > 0) ??
                          row.cells[0];
                        const todo = [
                          row.unlinked > 0
                            ? t("all.unlinked", { count: row.unlinked })
                            : null,
                          row.noDelivery > 0
                            ? t("all.noDelivery", { count: row.noDelivery })
                            : null,
                        ].filter(Boolean);
                        return (
                          <tr
                            key={row.code}
                            className="border-t border-[var(--line)] align-top"
                          >
                            <td className="px-5 py-3.5">
                              <Link
                                href={href(row.code, first.channel)}
                                className="font-bold hover:underline"
                              >
                                {countryName(row.code, locale)}
                              </Link>
                              <p className="text-xs text-[var(--muted)]">
                                {t("all.lines", { count: row.lines })}
                              </p>
                            </td>
                            {row.cells.map((cell) => {
                              const empty =
                                cell.active + cell.pending + cell.products ===
                                0;
                              return (
                                <td key={cell.channel} className="px-3 py-3">
                                  {empty ? (
                                    <span className="px-2 text-[var(--muted)]/50">
                                      —
                                    </span>
                                  ) : (
                                    <Link
                                      href={href(row.code, cell.channel)}
                                      className={`block rounded-lg px-2 py-1 transition-colors ${
                                        cell.blocked
                                          ? "bg-[var(--rust-soft)] text-[var(--rust-ink)] hover:ring-1 hover:ring-[var(--rust-ink)]"
                                          : "hover:bg-[var(--line)]/50"
                                      }`}
                                    >
                                      <span className="font-semibold tabular-nums">
                                        {cell.blocked
                                          ? t("all.noLine")
                                          : t("all.active", {
                                              count: cell.active,
                                            })}
                                      </span>
                                      <span className="block text-xs opacity-80">
                                        {[
                                          cell.products > 0
                                            ? t("all.products", {
                                                count: cell.products,
                                              })
                                            : null,
                                          cell.pending > 0
                                            ? t("all.pending", {
                                                count: cell.pending,
                                              })
                                            : null,
                                        ]
                                          .filter(Boolean)
                                          .join(" · ")}
                                      </span>
                                    </Link>
                                  )}
                                </td>
                              );
                            })}
                            <td className="px-5 py-3.5 text-xs">
                              {row.blocked === 0 && todo.length === 0 ? (
                                <span className="font-semibold text-emerald-700">
                                  {t("all.ok")}
                                </span>
                              ) : (
                                <span className="text-[var(--muted)]">
                                  {todo.join(" · ")}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
              <p className="text-xs text-[var(--muted)]">
                {t("all.legend", { grid: all.gridVersion })}
              </p>
            </>
          )}
        </div>
      </SourcerShell>
    );
  }

  const overview = await loadTransportOverview(c, ch, {
    withClientPrices: isAdmin,
  });
  const { destination, channel, lines } = overview;
  const storedPrices = destination
    ? await loadStoredLinePrices(destination, channel).catch(() => ({}))
    : {};
  const pill = (selected: boolean) =>
    `rounded-full px-4 py-1.5 text-sm ${selected ? "bg-[var(--navy)] font-semibold text-white" : "bg-[var(--card)] text-[var(--ink)] ring-1 ring-[var(--line)] hover:ring-[var(--navy)]"}`;
  const segment = (selected: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm ${selected ? "bg-[var(--card)] font-semibold text-[var(--ink)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]"}`;

  return (
    <SourcerShell role={ctx.role}>
      <div className="flex flex-col gap-6">
        {heading}

        {!overview.gridVersion || !destination ? (
          <p className="rounded-xl bg-[var(--rust-soft)] px-4 py-3 text-sm text-[var(--rust-ink)]">
            {t("noGrid")}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Link href="/sourcer/transport" className={pill(false)}>
                {t("all.back")}
              </Link>
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

            {overview.settingsReady ? null : (
              <p className="rounded-xl bg-[var(--gold-soft)] px-4 py-3 text-sm">
                {t("missingTable")}
              </p>
            )}
            <TransportTable
              key={`${destination}-${channel}`}
              destination={destination}
              channel={channel}
              placeLabel={`${countryName(destination, locale)} · ${tChannels(channel)}`}
              lines={lines}
              storedPrices={storedPrices}
              channelLabels={Object.fromEntries(
                TRANSPORT_CHANNELS.map((item) => [item, tChannels(item)]),
              )}
              canEdit={overview.settingsReady}
              locale={locale}
            />
            <p className="text-xs text-[var(--muted)]">
              {t("legend", { grid: overview.gridVersion })}
            </p>
          </>
        )}
      </div>
    </SourcerShell>
  );
}
