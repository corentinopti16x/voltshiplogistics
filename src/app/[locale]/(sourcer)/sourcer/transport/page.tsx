import { getLocale, getTranslations } from "next-intl/server";
import { OperationsTabs } from "@/components/admin/section-tabs";
import { SourcerShell } from "@/components/sourcer/sourcer-shell";
import { TransportTable } from "@/components/transport/transport-table";
import { Link, redirect } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { loadTransportOverview } from "@/lib/pricing/transport-server";
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
  const overview = await loadTransportOverview(c, ch, {
    withClientPrices: isAdmin,
  });
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

            {overview.settingsReady ? null : (
              <p className="rounded-xl bg-[var(--gold-soft)] px-4 py-3 text-sm">
                {t("missingTable")}
              </p>
            )}
            <TransportTable
              key={`${destination}-${channel}`}
              destination={destination}
              lines={lines}
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
