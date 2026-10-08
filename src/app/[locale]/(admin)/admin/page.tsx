import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createAdminClient } from "@/lib/supabase/admin";
import { listStaffRestockAlerts } from "@/lib/products/queries";
import { listStuckEccangOrders } from "@/lib/eccang/queries";
import { loadWeeklyFinance } from "@/lib/finance/weekly";
import { formatAmount, formatNumber } from "@/lib/format";
import { loadPricingTiers } from "@/lib/clients/pricing-tier";
import { pricingTierLabel } from "@/lib/domain/pricing-tiers";

type RecentProduct = {
  id: string;
  title: string;
  sourcing_status: string | null;
  lifecycle_status: string | null;
  created_at: string;
  clients: { name: string } | { name: string }[] | null;
};

type RecentClient = {
  id: string;
  name: string;
  plan_tier: string;
  created_at: string;
};

function relationName(relation: RecentProduct["clients"], fallback: string) {
  if (Array.isArray(relation)) return relation[0]?.name ?? fallback;
  return relation?.name ?? fallback;
}

export default async function AdminDashboardPage() {
  const [t, tExtra, tSourcing, locale] = await Promise.all([
    getTranslations("admin.dashboard"),
    getTranslations("admin.dashboardExtra"),
    getTranslations("products.sourcing"),
    getLocale(),
  ]);
  const sourcingLabel = (status: string | null) =>
    status == null
      ? tExtra("unassigned")
      : tSourcing.has(status)
        ? tSourcing(status)
        : status.replaceAll("_", " ");
  const admin = createAdminClient();

  const [
    clientsResult,
    usersResult,
    sourcingResult,
    quotesResult,
    activeShopsResult,
    shopErrorsResult,
    pendingAirtableResult,
    latestAirtableResult,
    deadEventsResult,
    activeGridResult,
    recentProductsResult,
    recentClientsResult,
    restockAlerts,
    eccangErrorsResult,
    stuckOrders,
    finance,
  ] = await Promise.all([
    admin.from("clients").select("id", { count: "exact", head: true }),
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin
      .from("products_cache")
      .select("id", { count: "exact", head: true })
      .in("sourcing_status", [
        "brief_received",
        "factories",
        "samples",
        "negotiation",
        "quote_sent",
        "flagged",
      ]),
    admin
      .from("products_cache")
      .select("id", { count: "exact", head: true })
      .eq("sourcing_status", "quote_sent")
      .is("accepted_quote_snapshot_json", null),
    admin
      .from("shops")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    admin
      .from("shops")
      .select("shopify_domain, sync_error")
      .not("sync_error", "is", null)
      .limit(5),
    admin
      .from("products_cache")
      .select("id", { count: "exact", head: true })
      .like("airtable_record_id", "pending:%"),
    admin
      .from("products_cache")
      .select("last_synced_at")
      .not("last_synced_at", "is", null)
      .order("last_synced_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "dead"),
    admin
      .from("pricing_meta")
      .select("value")
      .eq("key", "active_grid_version")
      .maybeSingle(),
    admin
      .from("products_cache")
      .select("id, title, sourcing_status, lifecycle_status, created_at, clients!inner(name)")
      .order("created_at", { ascending: false })
      .limit(6)
      .returns<RecentProduct[]>(),
    admin
      .from("clients")
      .select("id, name, plan_tier, created_at")
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<RecentClient[]>(),
    listStaffRestockAlerts(),
    admin
      .from("clients")
      .select("id, name, eccang_sync_error")
      .eq("eccang_enabled", true)
      .not("eccang_sync_error", "is", null)
      .limit(5),
    listStuckEccangOrders(48, 10).catch(() => []),
    // Confidential tile (voltship_admin only — the layout already enforces it); never blocks the page.
    loadWeeklyFinance({ count: 1 }).catch(() => null),
  ]);
  const currentWeek = finance?.weeks[finance.weeks.length - 1] ?? null;

  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
  });
  const activeGridValue = activeGridResult.data?.value;
  const activeGrid =
    activeGridValue && activeGridValue !== "uninitialized" ? activeGridValue : null;
  const recentProducts = recentProductsResult.data ?? [];
  const recentClients = recentClientsResult.data ?? [];
  const recentTiers = await loadPricingTiers(recentClients.map((client) => client.id));
  const shopErrors = shopErrorsResult.data ?? [];
  const syncErrors = shopErrors.length;
  const pendingAirtable = pendingAirtableResult.count ?? 0;
  const latestAirtableSync = latestAirtableResult.data?.last_synced_at ?? null;
  const deadEvents = deadEventsResult.count ?? 0;
  const eccangErrors = eccangErrorsResult.data ?? [];
  const attentionCount =
    syncErrors +
    deadEvents +
    pendingAirtable +
    (activeGrid ? 0 : 1) +
    eccangErrors.length +
    stuckOrders.length;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">
            {t("kicker")}
          </p>
          <h1 className="font-display mt-2 text-3xl">{t("title")}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{t("lead")}</p>
        </div>
        <Link
          href="/admin/clients/new"
          className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
        >
          {t("newClient")}
        </Link>
      </div>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Link
          href="/admin/finance"
          className={`rounded-2xl border p-5 transition hover:-translate-y-0.5 ${
            currentWeek && currentWeek.result < 0 ? "border-[var(--rust-ink)]/30 bg-[var(--rust-soft)]" : "border-[#d8bf76] bg-[#fbf5df]"
          }`}
        >
          <p className="text-xs text-[var(--muted)]">{t("metrics.finance")}</p>
          <p className="font-display tabular mt-2 text-3xl">
            {currentWeek ? formatAmount(currentWeek.result, locale) : "—"}
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            {currentWeek
              ? currentWeek.breakEven.perDay != null
                ? t("metrics.financeDetail", {
                    perDay: formatNumber(currentWeek.breakEven.perDay, locale, 1),
                    parcels: currentWeek.parcels,
                  })
                : t("metrics.financeNoBreakEven", { parcels: currentWeek.parcels })
              : t("metrics.financeUnavailable")}
          </p>
        </Link>
        <MetricCard
          label={t("metrics.clients")}
          value={clientsResult.count ?? 0}
          detail={t("metrics.users", { count: usersResult.count ?? 0 })}
          href="/admin/clients"
        />
        <MetricCard
          label={t("metrics.sourcing")}
          value={sourcingResult.count ?? 0}
          detail={t("metrics.sourcingDetail")}
          href="/sourcer"
        />
        <MetricCard
          label={t("metrics.quotes")}
          value={quotesResult.count ?? 0}
          detail={t("metrics.quotesDetail")}
          href="/sourcer?status=quote_sent"
          tone={(quotesResult.count ?? 0) > 0 ? "gold" : "default"}
        />
        <MetricCard
          label={t("metrics.shops")}
          value={activeShopsResult.count ?? 0}
          detail={t("metrics.shopsDetail")}
          href="/admin/shops"
        />
      </section>

      <section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{t("restock.title")}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("restock.lead")}</p>
          </div>
          <span className="rounded-full bg-[var(--bg)] px-2.5 py-1 text-xs text-[var(--muted)]">
            {restockAlerts.length}
          </span>
        </div>
        {restockAlerts.length === 0 ? (
          <p className="p-6 text-sm text-[var(--muted)]">{t("restock.empty")}</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {restockAlerts.slice(0, 8).map((alert) => (
              <li key={alert.product.id}>
                <Link
                  href={`/sourcer/${alert.product.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-white/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{alert.product.title}</span>
                    <span className="mt-1 block text-xs text-[var(--muted)]">
                      {alert.clientName}
                      {alert.status === "out_of_stock" ? ` · ${t("restock.out")}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-amber-800">
                    {alert.daysLeft == null
                      ? t("restock.out")
                      : t("restock.days", { days: Math.max(0, Math.floor(alert.daysLeft)) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">{t("recentProducts.title")}</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">{t("recentProducts.lead")}</p>
            </div>
            <Link href="/sourcer" className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">
              {t("viewQueue")}
            </Link>
          </div>
          {recentProducts.length === 0 ? (
            <p className="p-6 text-sm text-[var(--muted)]">{t("recentProducts.empty")}</p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {recentProducts.map((product) => (
                <li key={product.id}>
                  <Link
                    href={`/sourcer/${product.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-white/60"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{product.title}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {relationName(product.clients, tExtra("unknownClient"))} ·{" "}
                        <span className="capitalize">{sourcingLabel(product.sourcing_status)}</span>
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {date.format(new Date(product.created_at))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{t("attention.title")}</h2>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                attentionCount > 0
                  ? "bg-amber-100 text-amber-900"
                  : "bg-emerald-100 text-emerald-900"
              }`}
            >
              {attentionCount > 0
                ? t("attention.count", { count: attentionCount })
                : t("attention.clear")}
            </span>
          </div>
          <div className="mt-5 space-y-3">
            <HealthRow
              label={t("attention.rateGrid")}
              value={activeGrid ?? t("attention.notActive")}
              href="/admin/pricing"
              healthy={Boolean(activeGrid)}
            />
            <HealthRow
              label={t("attention.shopSync")}
              value={
                syncErrors > 0
                  ? shopErrors.map((shop) => shop.shopify_domain).join(", ")
                  : t("attention.healthy")
              }
              href="/admin/shops"
              healthy={syncErrors === 0}
            />
            <HealthRow
              label={t("attention.airtable")}
              value={
                pendingAirtable > 0
                  ? t("attention.pending", { count: pendingAirtable })
                  : latestAirtableSync
                    ? date.format(new Date(latestAirtableSync))
                    : t("attention.notSynced")
              }
              href="/admin/clients"
              healthy={pendingAirtable === 0}
            />
            <HealthRow
              label={t("attention.lifecycle")}
              value={t("attention.perClient")}
              href="/admin/clients"
              healthy
            />
            <HealthRow
              label={t("attention.eccangSync")}
              value={
                eccangErrors.length > 0
                  ? eccangErrors.map((client) => client.name).join(", ")
                  : t("attention.healthy")
              }
              href={eccangErrors[0] ? `/admin/clients/${eccangErrors[0].id}#eccang` : "/admin/clients"}
              healthy={eccangErrors.length === 0}
            />
            <HealthRow
              label={t("attention.eccangStuck")}
              value={
                stuckOrders.length > 0
                  ? t("attention.stuckOrders", { count: stuckOrders.length })
                  : t("attention.healthy")
              }
              href={stuckOrders[0] ? `/admin/clients/${stuckOrders[0].client_id}#eccang` : "/admin/clients"}
              healthy={stuckOrders.length === 0}
            />
            <HealthRow
              label={t("attention.webhooks")}
              value={
                deadEvents > 0
                  ? t("attention.failed", { count: deadEvents })
                  : t("attention.healthy")
              }
              href="/api/health"
              healthy={deadEvents === 0}
            />
          </div>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">{t("recentClients.title")}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("recentClients.lead")}</p>
          </div>
          <Link
            href="/admin/clients"
            className="text-xs text-[var(--muted)] hover:text-[var(--ink)]"
          >
            {t("viewClients")}
          </Link>
        </div>
        {recentClients.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-6 text-sm text-[var(--muted)]">
            {t("recentClients.empty")}
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentClients.map((client) => (
              <Link
                key={client.id}
                href={`/admin/clients/${client.id}`}
                className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 hover:border-[var(--accent)]"
              >
                <p className="text-sm font-medium">{client.name}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {pricingTierLabel(recentTiers.get(client.id))} · {date.format(new Date(client.created_at))}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  href,
  tone = "default",
}: {
  label: string;
  value: number;
  detail: string;
  href: string;
  tone?: "default" | "gold";
}) {
  return (
    <Link
      href={href}
      className={`rounded-2xl border p-5 transition hover:-translate-y-0.5 ${
        tone === "gold"
          ? "border-[#d8bf76] bg-[#fbf5df]"
          : "border-[var(--line)] bg-[var(--card)]"
      }`}
    >
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="font-display mt-2 text-3xl">{value}</p>
      <p className="mt-2 text-xs text-[var(--muted)]">{detail}</p>
    </Link>
  );
}

function HealthRow({
  label,
  value,
  href,
  healthy,
}: {
  label: string;
  value: string;
  href: string;
  healthy: boolean;
}) {
  const content = (
    <>
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${healthy ? "bg-emerald-500" : "bg-amber-500"}`}
        />
        {label}
      </span>
      <span className="max-w-[220px] truncate text-right text-xs text-[var(--muted)]">{value}</span>
    </>
  );
  const className =
    "flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3 py-3 text-sm hover:bg-white";

  return href.startsWith("/api/") ? (
    <a href={href} className={className}>
      {content}
    </a>
  ) : (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
