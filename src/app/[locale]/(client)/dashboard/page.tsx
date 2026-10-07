import { getActiveShopId } from "@/lib/shops/active";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import {
  getResearchState,
  RESEARCH_KINDS,
  SIMPLE_PIPELINE,
  simpleStage,
  type ProductRow,
  type ResearchKind,
} from "@/lib/products/types";
import { listRestockAlerts, sumOrdersShipped } from "@/lib/products/queries";
import { loadProductInsights, type ProductInsight } from "@/lib/products/overview";
import { LaunchRestockButton } from "@/components/client/launch-restock-button";
import { ProductCard } from "@/components/client/product-card";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadClientRecurrence, type RecurrenceSnapshot } from "@/lib/shopify/recurrence";
import {
  isClientEccangEnabled,
  listRecentEccangOrders,
  trackingUrl,
  type EccangOrderRow,
} from "@/lib/eccang/queries";
import {
  Badge,
  Bolt,
  ButtonLink,
  Card,
  CountPill,
  EmptyState,
  PageTitle,
  SectionTitle,
  Stat,
} from "@/components/ui";
import { formatDate, formatDays, formatNumber, formatPercent } from "@/lib/format";

type NotificationRow = {
  id: string;
  type: string;
  created_at: string;
  read_at: string | null;
  payload_json: {
    message?: string;
    productId?: string;
  } | null;
};

type ReadyResearch = {
  product: ProductRow;
  kind: ResearchKind;
  readyAt: string;
  title: string;
};

export default async function DashboardPage() {
  const [t, tp, locale] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("products.card"),
    getLocale(),
  ]);
  const ctx = await getAuthContext();
  const client = ctx?.client;
  const clientId = ctx?.clientId;

  let insights: ProductInsight[] = [];
  let orders: { today: number; week: number; month: number; source: "fulfilled" | "placed" } = {
    today: 0,
    week: 0,
    month: 0,
    source: "placed",
  };
  let restockAlerts: Awaited<ReturnType<typeof listRestockAlerts>> = [];
  let notifications: NotificationRow[] = [];
  let recurrence: RecurrenceSnapshot | null = null;
  let warehouseOrders: EccangOrderRow[] = [];
  let warehouseLive = false;
  let loadError = false;

  const activeShopId = clientId ? await getActiveShopId(clientId) : null;
  if (clientId) {
    try {
      const admin = createAdminClient();
      const [overview, orderTotals, notificationResult, recurrenceResult, eccangEnabled] =
        await Promise.all([
          loadProductInsights(clientId, activeShopId),
          sumOrdersShipped(clientId, activeShopId),
          admin
            .from("notifications")
            .select("id, type, created_at, read_at, payload_json")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(12)
            .returns<NotificationRow[]>(),
          loadClientRecurrence(clientId, [], 60, activeShopId).catch(() => null),
          isClientEccangEnabled(clientId),
        ]);
      insights = overview.insights;
      orders = orderTotals;
      notifications = notificationResult.data ?? [];
      recurrence = recurrenceResult;
      warehouseLive = eccangEnabled;
      if (eccangEnabled) {
        warehouseOrders = await listRecentEccangOrders(clientId, 6).catch(() => []);
      }
      restockAlerts = await listRestockAlerts(clientId, overview.products);
    } catch {
      loadError = true;
    }
  }

  const products = insights.map((row) => row.product);
  const activeProducts = insights.filter((row) => row.product.lifecycle_status !== "dead");
  const quotesPending = insights.filter((row) => row.quotePending);
  const sourcingOpen = insights.filter((row) => row.sourcingOpen);
  const alertIds = new Set(restockAlerts.map((alert) => alert.product.id));
  const unread = notifications.filter((row) => !row.read_at);
  const orderedNotifications = [...unread, ...notifications.filter((row) => row.read_at)];
  const decisions = quotesPending.length + restockAlerts.length;

  // Product cards: live catalogue first (winning, then testing…), ranked by 90-day sales.
  const lifecycleRank: Record<string, number> = { winning: 0, testing: 1, declining: 2, dead: 3 };
  const featured = [...insights]
    .sort((a, b) => {
      const rankA = lifecycleRank[a.product.lifecycle_status ?? ""] ?? 4;
      const rankB = lifecycleRank[b.product.lifecycle_status ?? ""] ?? 4;
      if (rankA !== rankB) return rankA - rankB;
      return (b.metrics?.units90 ?? -1) - (a.metrics?.units90 ?? -1);
    })
    .slice(0, 6);

  const readyResearch = products
    .flatMap((product) => {
      const state = getResearchState(product);
      return RESEARCH_KINDS.flatMap((kind): ReadyResearch[] => {
        const block = state[kind];
        if (block.status !== "ready") return [];
        return [
          {
            product,
            kind,
            readyAt: block.ready_at ?? product.created_at,
            title: block.title ?? t(`researchKinds.${kind}`),
          },
        ];
      });
    })
    .sort((a, b) => Date.parse(b.readyAt) - Date.parse(a.readyAt));

  const today = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        kicker={today.charAt(0).toUpperCase() + today.slice(1)}
        title={t("greeting", { name: client?.name ?? t("title") })}
        lead={t("summary", {
          decisions,
          shipped: formatNumber(orders.today, locale),
        })}
        actions={
          <ButtonLink href="/products/new" variant="gold">
            <Bolt fill="#10284A" />
            {t("newProduct")}
          </ButtonLink>
        }
      />

      {loadError ? (
        <p className="rounded-xl border border-[#f0d9b5] bg-[var(--gold-soft)] px-4 py-3 text-sm text-[var(--gold-ink)]">
          {t("migrationHint")}
        </p>
      ) : null}

      {/* KPIs — orders from sumOrdersShipped (Shopify orders cache), the rest from products_cache */}
      <section aria-label={t("kpi.sectionLabel")} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Card padding="sm" className="px-5 py-4">
          <Stat
            label={t("kpi.orders")}
            value={formatNumber(orders.today, locale)}
            sub={orders.source === "fulfilled" ? t("kpi.fulfilled") : t("kpi.placed")}
            pill={<Badge tone="gold">{t("kpi.today")}</Badge>}
          />
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--line-soft)] pt-3">
            <MiniStat label={t("kpi.week")} value={formatNumber(orders.week, locale)} />
            <MiniStat label={t("kpi.month")} value={formatNumber(orders.month, locale)} />
          </div>
        </Card>
        <KpiLink href="/products">
          <Stat
            label={t("kpi.activeProducts")}
            value={formatNumber(activeProducts.length, locale)}
            sub={t("kpi.activeProductsDetail", { total: products.length })}
            pill={
              <Badge tone="blue">
                {t("kpi.lifecycleMix", {
                  winning: insights.filter((row) => row.product.lifecycle_status === "winning").length,
                  testing: insights.filter((row) => row.product.lifecycle_status === "testing").length,
                })}
              </Badge>
            }
          />
        </KpiLink>
        <KpiLink href={quotesPending[0] ? `/products/${quotesPending[0].product.id}` : "/products"}>
          <Stat
            label={t("kpi.quotes")}
            value={formatNumber(quotesPending.length, locale)}
            sub={quotesPending[0]?.product.title ?? t("kpi.quotesDetail")}
            tone={quotesPending.length > 0 ? "gold" : "default"}
            pill={quotesPending.length > 0 ? <Badge tone="gold">{t("kpi.toReview")}</Badge> : null}
          />
        </KpiLink>
        <KpiLink href="/products?sourcing=open">
          <Stat
            label={t("kpi.sourcing")}
            value={formatNumber(sourcingOpen.length, locale)}
            sub={t("kpi.sourcingDetail")}
            pill={
              restockAlerts.length > 0 ? (
                <Badge tone="rust">{t("kpi.stockAlerts", { count: restockAlerts.length })}</Badge>
              ) : null
            }
          />
        </KpiLink>
        {/* Récurrence — loadClientRecurrence over shopify_orders_cache.customer_key */}
        {!recurrence || !recurrence.shopConnected ? (
          <KpiLink href="/settings">
            <Stat
              label={t("kpi.recurrence")}
              value="—"
              tone="muted"
              sub={t("kpi.recurrenceConnect")}
            />
          </KpiLink>
        ) : recurrence.client.customers === 0 ? (
          <Card padding="sm" className="px-5 py-4">
            <Stat
              label={t("kpi.recurrence")}
              value="—"
              tone="muted"
              sub={
                recurrence.client.ordersTotal > 0
                  ? t("kpi.recurrenceNoCustomer", { orders: formatNumber(recurrence.client.ordersTotal, locale) })
                  : t("kpi.recurrenceNoOrders")
              }
            />
          </Card>
        ) : (
          <Card padding="sm" className="px-5 py-4">
            <Stat
              label={t("kpi.recurrence")}
              value={formatPercent(recurrence.client.repeatRate, locale)}
              sub={t("kpi.recurrenceRepeat", {
                repeat: formatNumber(recurrence.client.repeatCustomers, locale),
                customers: formatNumber(recurrence.client.customers, locale),
              })}
              pill={
                recurrence.client.returningOrderShare != null ? (
                  <Badge tone="blue">
                    {t("kpi.recurrenceReturning", {
                      share: formatPercent(recurrence.client.returningOrderShare, locale),
                    })}
                  </Badge>
                ) : null
              }
            />
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--line-soft)] pt-3">
              <MiniStat
                label={t("kpi.recurrencePerCustomer")}
                value={formatNumber(recurrence.client.ordersPerCustomer, locale, 1)}
              />
              <MiniStat
                label={t("kpi.recurrenceSecond")}
                value={
                  recurrence.client.medianDaysToSecondOrder == null
                    ? "—"
                    : t("kpi.recurrenceDays", {
                        days: formatNumber(recurrence.client.medianDaysToSecondOrder, locale),
                      })
                }
              />
            </div>
            <p className="mt-2 text-[11px] text-[var(--faint)]">
              {t("kpi.recurrenceWindow", { days: formatNumber(recurrence.client.windowDays, locale) })}
            </p>
          </Card>
        )}
      </section>

      {/* Restock alerts — listRestockAlerts (sales_cache + stock_cache + safety stock rule) */}
      {restockAlerts.length > 0 ? (
        <Card as="section" padding="md" className="border-[#f3cdb5]">
          <SectionTitle
            sub={t("restock.lead")}
            aside={<CountPill tone="rust">{restockAlerts.length}</CountPill>}
          >
            {t("restock.title", { count: restockAlerts.length })}
          </SectionTitle>
          <ul className="mt-2 divide-y divide-[var(--line-soft)]">
            {restockAlerts.slice(0, 6).map((alert) => (
              <li
                key={alert.product.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 last:pb-0"
              >
                <div className="min-w-0">
                  <Link
                    href={`/products/${alert.product.id}`}
                    className="block truncate text-sm font-semibold hover:underline"
                  >
                    {alert.product.title}
                  </Link>
                  <p className="mt-0.5 text-[12px] text-[var(--rust-ink)]">
                    {alert.status === "out_of_stock"
                      ? alert.stockoutSince
                        ? t("restock.stockout", {
                            date: formatDate(`${alert.stockoutSince}T00:00:00`, locale),
                            units: alert.lostUnits ?? 0,
                          })
                        : t("restock.out")
                      : t("restock.days", { days: formatDays(alert.daysLeft, locale) })}
                    {alert.suggestedQty > 0
                      ? ` · ${t("restock.suggested", { qty: formatNumber(alert.suggestedQty, locale) })}`
                      : ""}
                  </p>
                </div>
                <LaunchRestockButton productId={alert.product.id} qty={alert.suggestedQty} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Warehouse orders — eccang_orders (ref, status, carrier, tracking, billed weight) */}
      {warehouseLive ? (
        <Card as="section" padding="none">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--line-soft)] px-5 py-4">
            <SectionTitle sub={t("warehouse.lead")}>{t("warehouse.title")}</SectionTitle>
            <Badge tone="green" dot>
              {t("warehouse.live")}
            </Badge>
          </div>
          {warehouseOrders.length === 0 ? (
            <p className="px-5 py-5 text-sm text-[var(--muted)]">{t("warehouse.empty")}</p>
          ) : (
            <ul className="divide-y divide-[var(--line-soft)]">
              {warehouseOrders.map((row) => {
                const link = trackingUrl(row.tracking_no, row.carrier_code);
                const statusKey = ["C", "W", "D", "H", "N", "P", "X"].includes(row.status) ? row.status : "pending";
                const tone =
                  row.status === "D" ? "green" : row.status === "N" || row.status === "P" ? "rust" : row.status === "X" ? "grey" : "blue";
                return (
                  <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                    <span className="min-w-[160px] font-semibold">{row.reference_no}</span>
                    <Badge tone={tone}>{t(`warehouse.status.${statusKey}`)}</Badge>
                    <span className="text-[12px] text-[var(--muted)]">
                      {row.carrier_code ?? row.shipping_method ?? "—"}
                    </span>
                    {row.tracking_no ? (
                      link ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[12px] font-semibold text-[var(--blue-ink)] hover:underline"
                        >
                          {row.tracking_no} ↗
                        </a>
                      ) : (
                        <span className="text-[12px]">{row.tracking_no}</span>
                      )
                    ) : (
                      <span className="text-[12px] text-[var(--faint)]">{t("warehouse.noTracking")}</span>
                    )}
                    <span className="ml-auto text-[12px] text-[var(--muted)]">
                      {row.billed_weight_g != null
                        ? t("warehouse.billedWeight", { grams: formatNumber(row.billed_weight_g, locale) })
                        : formatDate(row.pushed_at ?? row.created_at, locale)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Product cards */}
        <section className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <SectionTitle sub={t("products.lead")}>{t("products.title")}</SectionTitle>
            <Link href="/products" className="text-[13px] font-bold text-[var(--blue-ink)] hover:underline">
              {t("seeAll")} →
            </Link>
          </div>
          {featured.length === 0 ? (
            <EmptyState>{t("products.empty")}</EmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {featured.map((insight) => (
                <ProductCard
                  key={insight.product.id}
                  insight={insight}
                  stockAlert={alertIds.has(insight.product.id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Right column: to-do + sourcing pipeline */}
        <div className="flex min-w-0 flex-col gap-5">
          <Card as="section" padding="md">
            <SectionTitle aside={<CountPill tone={decisions > 0 ? "gold" : "grey"}>{decisions}</CountPill>}>
              {t("actions.title")}
            </SectionTitle>
            <div className="mt-3 flex flex-col gap-2">
              {quotesPending.slice(0, 3).map((row) => (
                <TodoRow
                  key={`quote-${row.product.id}`}
                  href={`/products/${row.product.id}`}
                  tag={t("actions.quoteTag")}
                  tone="gold"
                  title={row.product.title}
                  sub={t("actions.reviewQuote")}
                />
              ))}
              {restockAlerts.slice(0, 3).map((alert) => (
                <TodoRow
                  key={`stock-${alert.product.id}`}
                  href={`/products/${alert.product.id}`}
                  tag={t("actions.stockTag")}
                  tone="rust"
                  title={alert.product.title}
                  sub={
                    alert.daysLeft == null
                      ? t("restock.out")
                      : t("actions.daysLeft", { days: formatDays(alert.daysLeft, locale) })
                  }
                />
              ))}
              {readyResearch.slice(0, 2).map((item) => (
                <TodoRow
                  key={`research-${item.product.id}-${item.kind}`}
                  href={`/products/${item.product.id}`}
                  tag={t("actions.researchTag")}
                  tone="blue"
                  title={item.product.title}
                  sub={item.title}
                />
              ))}
              {decisions === 0 && readyResearch.length === 0 ? (
                <EmptyState>{t("actions.empty")}</EmptyState>
              ) : null}
            </div>
          </Card>

          <Card as="section" padding="md">
            <SectionTitle
              sub={t("pipeline.lead")}
              aside={
                <Link href="/products?sourcing=open" className="font-bold text-[var(--blue-ink)] hover:underline">
                  {t("seeAll")} →
                </Link>
              }
            >
              {t("pipeline.title")}
            </SectionTitle>
            {sourcingOpen.length === 0 ? (
              <div className="mt-3">
                <EmptyState>{t("inProgressEmpty")}</EmptyState>
              </div>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {sourcingOpen.slice(0, 5).map(({ product }) => {
                  const stage = simpleStage(product.sourcing_status);
                  const index = SIMPLE_PIPELINE.indexOf(stage);
                  return (
                    <li key={product.id}>
                      <Link href={`/products/${product.id}`} className="group block">
                        <span className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-semibold group-hover:underline">
                            {product.title}
                          </span>
                          <span className="shrink-0 text-[12px] font-semibold text-[var(--muted)]">
                            {tp(`simpleStage.${stage}`)}
                          </span>
                        </span>
                        <span className="mt-1.5 flex gap-[3px]" aria-hidden>
                          {SIMPLE_PIPELINE.map((step, stepIndex) => (
                            <span
                              key={step}
                              className={`h-1 flex-1 rounded-sm ${
                                stepIndex <= index ? "bg-[var(--gold)]" : "bg-[var(--line-soft)]"
                              }`}
                            />
                          ))}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Research deliverables — quote_json._research blocks with status ready */}
        <Card as="section" padding="none">
          <div className="border-b border-[var(--line-soft)] px-5 py-4">
            <SectionTitle sub={t("research.lead")}>{t("research.title")}</SectionTitle>
          </div>
          {readyResearch.length === 0 ? (
            <p className="px-5 py-5 text-sm text-[var(--muted)]">{t("research.empty")}</p>
          ) : (
            <ul className="divide-y divide-[var(--line-soft)]">
              {readyResearch.slice(0, 5).map((item) => (
                <li key={`${item.product.id}:${item.kind}`}>
                  <Link
                    href={`/products/${item.product.id}`}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--card-soft)]"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--blue-soft)]">
                      <Bolt fill="#3D74C4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{item.title}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-[var(--muted)]">
                        {item.product.title} · {t(`researchKinds.${item.kind}`)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] text-[var(--faint)]">
                      {formatDate(item.readyAt, locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Notifications — notifications table, unread first */}
        <Card as="section" padding="none">
          <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line-soft)] px-5 py-4">
            <SectionTitle sub={t("activity.unread", { count: unread.length })}>
              {t("activity.title")}
            </SectionTitle>
            <Link href="/notifications" className="text-[13px] font-bold text-[var(--blue-ink)] hover:underline">
              {t("seeAll")} →
            </Link>
          </div>
          {orderedNotifications.length === 0 ? (
            <p className="px-5 py-5 text-sm text-[var(--muted)]">{t("activity.empty")}</p>
          ) : (
            <ul className="divide-y divide-[var(--line-soft)]">
              {orderedNotifications.slice(0, 6).map((row) => {
                const productId = row.payload_json?.productId;
                const isUnread = !row.read_at;
                const content = (
                  <>
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${
                        isUnread ? "bg-[var(--gold-soft)]" : "bg-[var(--grey-soft)]"
                      }`}
                    >
                      <Bolt fill={isUnread ? "#D9A03A" : "#9AA8BA"} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${isUnread ? "font-bold" : "font-medium"}`}>
                        {row.payload_json?.message ?? row.type.replaceAll("_", " ")}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-[var(--muted)]">
                        {formatDate(row.created_at, locale, true)}
                      </span>
                    </span>
                    {isUnread ? (
                      <span aria-label={t("activity.unreadOne")} className="h-2 w-2 shrink-0 rounded-full bg-[var(--gold)]" />
                    ) : null}
                  </>
                );
                const rowClass = `flex items-center gap-3 px-5 py-3.5 ${isUnread ? "bg-[#fffcf5]" : ""}`;
                return (
                  <li key={row.id}>
                    {productId ? (
                      <Link href={`/products/${productId}`} className={`${rowClass} hover:bg-[var(--card-soft)]`}>
                        {content}
                      </Link>
                    ) : (
                      <div className={rowClass}>{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-semibold text-[var(--muted)]">{label}</span>
      <span className="font-display tabular text-[20px] font-extrabold">{value}</span>
    </div>
  );
}

function KpiLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="vs-card vs-card-hover block px-5 py-4 text-[var(--ink)]">
      {children}
    </Link>
  );
}

function TodoRow({
  href,
  tag,
  tone,
  title,
  sub,
}: {
  href: string;
  tag: string;
  tone: "gold" | "rust" | "blue";
  title: string;
  sub: string;
}) {
  const bg = tone === "gold" ? "bg-[var(--gold-soft)]" : tone === "rust" ? "bg-[var(--rust-soft)]" : "bg-[var(--blue-soft)]";
  const fill = tone === "gold" ? "#D9A03A" : tone === "rust" ? "#C2561F" : "#3D74C4";
  const tagColor =
    tone === "gold" ? "text-[var(--gold-ink)]" : tone === "rust" ? "text-[var(--rust-ink)]" : "text-[var(--blue-ink)]";
  return (
    <Link
      href={href}
      className="vs-card-hover flex items-center gap-3 rounded-[14px] border border-[var(--line-soft)] bg-[var(--card-soft)] px-3.5 py-3 text-[var(--ink)]"
    >
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[11px] ${bg}`}>
        <Bolt fill={fill} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`text-[11px] font-bold tracking-[0.06em] uppercase ${tagColor}`}>{tag}</span>
        <span className="truncate text-sm font-bold">{title}</span>
        <span className="truncate text-[12px] text-[var(--muted)]">{sub}</span>
      </span>
      <span aria-hidden className="font-bold text-[var(--faint)]">
        →
      </span>
    </Link>
  );
}
