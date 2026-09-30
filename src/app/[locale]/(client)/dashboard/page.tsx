import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import {
  getResearchState,
  isQuoteAccepted,
  isQuoteReady,
  isSourcingOpen,
  RESEARCH_KINDS,
  type ProductRow,
  type ResearchKind,
} from "@/lib/products/types";
import {
  listRestockAlerts,
  listTenantProducts,
  sumOrdersShipped,
} from "@/lib/products/queries";
import { LaunchRestockButton } from "@/components/client/launch-restock-button";
import { LifecycleBadge } from "@/components/client/lifecycle-badge";
import { createAdminClient } from "@/lib/supabase/admin";

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
  const [t, locale] = await Promise.all([
    getTranslations("dashboard"),
    getLocale(),
  ]);
  const ctx = await getAuthContext();
  const client = ctx?.client;
  const clientId = ctx?.clientId;

  let products: Awaited<ReturnType<typeof listTenantProducts>> = [];
  let orders: { today: number; week: number; month: number; source: "fulfilled" | "placed" } = {
    today: 0,
    week: 0,
    month: 0,
    source: "placed",
  };
  let restockAlerts: Awaited<ReturnType<typeof listRestockAlerts>> = [];
  let notifications: NotificationRow[] = [];
  let loadError = false;

  if (clientId) {
    try {
      const admin = createAdminClient();
      const [productRows, orderTotals, notificationResult] = await Promise.all([
        listTenantProducts(clientId),
        sumOrdersShipped(clientId),
        admin
          .from("notifications")
          .select("id, type, created_at, read_at, payload_json")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(8)
          .returns<NotificationRow[]>(),
      ]);
      products = productRows;
      orders = orderTotals;
      notifications = notificationResult.data ?? [];
      restockAlerts = await listRestockAlerts(clientId, products);
    } catch {
      loadError = true;
    }
  }

  const inProgress = products.filter((product) => isSourcingOpen(product.sourcing_status));
  const activeProducts = products.filter(
    (product) => product.lifecycle_status !== "dead",
  );
  const quotesReady = products.filter(
    (product) =>
      isQuoteReady(product) &&
      !isQuoteAccepted(product) &&
      product.sourcing_status === "quote_sent",
  );
  const stockAlerts = restockAlerts;
  const unreadCount = notifications.filter((row) => !row.read_at).length;
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
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
  });

  return (
    <div>
      <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">
        {client?.name}
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight">{t("title")}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {t("overview", { plan: client?.plan_tier ?? "—" })}
          </p>
        </div>
        <Link
          href="/products/new"
          className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
        >
          {t("newProduct")}
        </Link>
      </div>

      {loadError ? (
        <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t("migrationHint")}
        </p>
      ) : null}

      {stockAlerts.length > 0 ? (
        <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold">
            {t("restock.title", { count: stockAlerts.length })}
          </h2>
          <ul className="mt-3 divide-y divide-amber-200/80">
            {stockAlerts.slice(0, 6).map((alert) => (
              <li
                key={alert.product.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{alert.product.title}</p>
                  <p className="mt-1 text-xs text-amber-900">
                    {alert.status === "out_of_stock"
                      ? alert.stockoutSince
                        ? t("restock.stockout", {
                            date: date.format(new Date(`${alert.stockoutSince}T00:00:00`)),
                            units: alert.lostUnits ?? 0,
                          })
                        : t("restock.out")
                      : t("restock.days", {
                          days: Math.max(0, Math.floor(alert.daysLeft ?? 0)),
                        })}
                  </p>
                </div>
                <LaunchRestockButton
                  productId={alert.product.id}
                  qty={alert.suggestedQty}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 sm:col-span-2">
          <p className="text-xs text-[var(--muted)]">{t("kpi.orders")}</p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            {orders.source === "fulfilled" ? t("kpi.fulfilled") : t("kpi.placed")}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <OrderStat label={t("kpi.today")} value={orders.today} />
            <OrderStat label={t("kpi.week")} value={orders.week} />
            <OrderStat label={t("kpi.month")} value={orders.month} />
          </div>
        </article>
        <Kpi
          label={t("kpi.activeProducts")}
          value={activeProducts.length}
          detail={t("kpi.activeProductsDetail", { total: products.length })}
          href="/products"
        />
        <Kpi
          label={t("kpi.quotes")}
          value={quotesReady.length}
          detail={t("kpi.quotesDetail")}
          href={quotesReady[0] ? `/products/${quotesReady[0].id}` : "/products"}
          tone={quotesReady.length > 0 ? "gold" : "default"}
        />
        <Kpi
          label={t("kpi.stock")}
          value={stockAlerts.length}
          detail={t("kpi.stockDetail")}
          href="/products"
          tone={stockAlerts.length > 0 ? "warning" : "default"}
        />
      </section>

      <section className="mt-10">
        <div>
          <h2 className="text-sm font-semibold">{t("actions.title")}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{t("actions.lead")}</p>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <ActionPanel
            title={t("actions.quotes")}
            count={quotesReady.length}
            empty={t("actions.quotesEmpty")}
          >
            {quotesReady.slice(0, 3).map((product) => (
              <Link
                key={product.id}
                href={`/products/${product.id}`}
                className="flex items-center justify-between gap-4 border-t border-[var(--line)] px-4 py-3 text-sm first:border-t-0 hover:bg-white"
              >
                <span className="min-w-0 truncate font-medium">{product.title}</span>
                <span className="shrink-0 text-xs text-[var(--accent)]">
                  {t("actions.reviewQuote")} →
                </span>
              </Link>
            ))}
          </ActionPanel>

          <ActionPanel
            title={t("actions.stock")}
            count={stockAlerts.length}
            empty={t("actions.stockEmpty")}
          >
            {stockAlerts.slice(0, 3).map((alert) => (
              <Link
                key={alert.product.id}
                href={`/products/${alert.product.id}`}
                className="flex items-center justify-between gap-4 border-t border-[var(--line)] px-4 py-3 text-sm first:border-t-0 hover:bg-white"
              >
                <span className="min-w-0 truncate font-medium">{alert.product.title}</span>
                <span className="shrink-0 text-xs text-amber-800">
                  {alert.daysLeft == null
                    ? t("restock.out")
                    : t("actions.daysLeft", {
                        days: Math.max(0, Math.floor(alert.daysLeft)),
                      })}
                </span>
              </Link>
            ))}
          </ActionPanel>
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("inProgress")}</h2>
          <Link href="/products" className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">
            {t("seeAll")}
          </Link>
        </div>
        {inProgress.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-6 text-sm text-[var(--muted)]">
            {t("inProgressEmpty")}
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {inProgress.slice(0, 4).map((product) => (
              <Link
                key={product.id}
                href={`/products/${product.id}`}
                className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4"
              >
                <LifecycleBadge status={product.lifecycle_status} />
                <p className="mt-2 text-sm font-medium">{product.title}</p>
                <p className="mt-1 text-xs capitalize text-[var(--muted)]">
                  {(product.sourcing_status ?? "").replaceAll("_", " ")}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">{t("activity.title")}</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {t("activity.unread", { count: unreadCount })}
              </p>
            </div>
            <Link
              href="/notifications"
              className="text-xs text-[var(--muted)] hover:text-[var(--ink)]"
            >
              {t("seeAll")}
            </Link>
          </div>
          {notifications.length === 0 ? (
            <p className="p-6 text-sm text-[var(--muted)]">{t("activity.empty")}</p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {notifications.slice(0, 4).map((row) => {
                const productId = row.payload_json?.productId;
                const content = (
                  <>
                    <span
                      aria-hidden
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        row.read_at ? "bg-[var(--line)]" : "bg-[var(--gold)]"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {row.payload_json?.message ?? row.type.replaceAll("_", " ")}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--muted)]">
                        {date.format(new Date(row.created_at))}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={row.id}>
                    {productId ? (
                      <Link
                        href={`/products/${productId}`}
                        className="flex gap-3 px-5 py-4 hover:bg-white"
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="flex gap-3 px-5 py-4">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <div className="border-b border-[var(--line)] px-5 py-4">
            <h2 className="text-sm font-semibold">{t("research.title")}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("research.lead")}</p>
          </div>
          {readyResearch.length === 0 ? (
            <p className="p-6 text-sm text-[var(--muted)]">{t("research.empty")}</p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {readyResearch.slice(0, 4).map((item) => (
                <li key={`${item.product.id}:${item.kind}`}>
                  <Link
                    href={`/products/${item.product.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-white"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      <span className="mt-1 block truncate text-xs text-[var(--muted)]">
                        {item.product.title}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {date.format(new Date(item.readyAt))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function OrderStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-display text-2xl sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}

function Kpi({
  label,
  value,
  detail,
  href,
  tone = "default",
}: {
  label: string;
  value: number;
  detail: string;
  href?: string;
  tone?: "default" | "gold" | "warning";
}) {
  const content = (
    <>
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="font-display mt-2 text-3xl">{value}</p>
      <p className="mt-2 text-xs text-[var(--muted)]">{detail}</p>
    </>
  );
  const classes = `rounded-2xl border p-5 ${
    tone === "gold"
      ? "border-[#d8bf76] bg-[#fbf5df]"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50"
        : "border-[var(--line)] bg-[var(--card)]"
  }`;

  if (href) {
    return (
      <Link href={href} className={`${classes} transition hover:-translate-y-0.5`}>
        {content}
      </Link>
    );
  }

  return (
    <article className={classes}>{content}</article>
  );
}

function ActionPanel({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="rounded-full bg-[var(--bg)] px-2.5 py-1 text-xs text-[var(--muted)]">
          {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="border-t border-[var(--line)] px-4 py-5 text-sm text-[var(--muted)]">
          {empty}
        </p>
      ) : (
        children
      )}
    </div>
  );
}
