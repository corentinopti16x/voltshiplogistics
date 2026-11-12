import { getActiveShopId } from "@/lib/shops/active";
import { getTranslations } from "next-intl/server";
import { getAuthContext } from "@/lib/auth/context";
import { listRestockAlerts } from "@/lib/products/queries";
import { loadProductInsights, type ProductInsight } from "@/lib/products/overview";
import { ProductCard } from "@/components/client/product-card";
import { SIMPLE_PIPELINE, isMigratedProduct, simpleStage } from "@/lib/products/types";
import { parseDashboardPeriod } from "@/lib/products/periods";
import { Bolt, ButtonLink, EmptyState, PageTitle } from "@/components/ui";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    lifecycle?: string;
    sourcing?: string;
    sort?: string;
    min?: string;
    period?: string;
  }>;
}) {
  const t = await getTranslations("products");
  const ctx = await getAuthContext();
  const filters = await searchParams;
  const q = (filters.q ?? "").trim().toLowerCase();
  const lifecycle = filters.lifecycle ?? "";
  const sourcing = filters.sourcing ?? "";
  const period = parseDashboardPeriod(filters.period);
  const legacySort: Record<string, string> = {
    sales90: "sales",
    sales30: "sales",
    sales7: "sales",
    sales24h: "sales",
  };
  const sort = legacySort[filters.sort ?? ""] ?? filters.sort ?? "sales";
  const minSalesRaw = filters.min ?? "";
  const minSales = Math.max(0, Number(minSalesRaw) || 0);

  let insights: ProductInsight[] = [];
  let alertIds = new Set<string>();
  let loadError = false;
  if (ctx?.clientId) {
    try {
      const overview = await loadProductInsights(
        ctx.clientId,
        await getActiveShopId(ctx.clientId),
      );
      insights = overview.insights;
      const alerts = await listRestockAlerts(ctx.clientId, overview.products);
      alertIds = new Set(alerts.map((alert) => alert.product.id));
    } catch {
      loadError = true;
    }
  }

  const unitsOf = (row: ProductInsight) => row.metrics?.windows[period].units ?? null;
  const revenueOf = (row: ProductInsight) => row.metrics?.windows[period].revenue ?? null;

  const visible = insights.filter(({ product, sourcingOpen }) => {
    if (q && !product.title.toLowerCase().includes(q)) return false;
    if (lifecycle && product.lifecycle_status !== lifecycle) return false;
    if (sourcing === "open") return sourcingOpen;
    if (sourcing && (SIMPLE_PIPELINE as readonly string[]).includes(sourcing)) {
      return !isMigratedProduct(product) && simpleStage(product.sourcing_status) === sourcing;
    }
    if (sourcing && product.sourcing_status !== sourcing) return false;
    return true;
  }).filter((row) => (minSales > 0 ? (unitsOf(row) ?? 0) >= minSales : true));

  const num = (value: number | null | undefined, empty: number) =>
    value == null || !Number.isFinite(value) ? empty : value;
  visible.sort((a, b) => {
    switch (sort) {
      case "revenue":
        return num(revenueOf(b), -1) - num(revenueOf(a), -1);
      case "salesLow":
        return num(unitsOf(a), 0) - num(unitsOf(b), 0);
      case "profit":
        return num(b.economics.profit, -Infinity) - num(a.economics.profit, -Infinity);
      case "price":
        return num(b.product.selling_price, -1) - num(a.product.selling_price, -1);
      case "newest":
        return (b.product.created_at ?? "").localeCompare(a.product.created_at ?? "");
      case "name":
        return a.product.title.localeCompare(b.product.title);
      default:
        return num(unitsOf(b), -1) - num(unitsOf(a), -1);
    }
  });


  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        bandClass="h-[400px] sm:h-[360px]"
        title={t("title")}
        lead={t("lead")}
        actions={
          <ButtonLink href="/products/new" variant="gold">
            <Bolt fill="#10284A" />
            {t("new")}
          </ButtonLink>
        }
      />

      <form method="get" className="flex max-w-md gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder={t("searchField")}
          aria-label={t("searchField")}
          className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm outline-none focus:border-[var(--navy)]"
        />
        <button className="cursor-pointer rounded-xl bg-[var(--navy)] px-4 py-2.5 text-sm font-semibold text-white">
          {t("searchButton")}
        </button>
      </form>

      {loadError ? (
        <p className="rounded-xl border border-[#f0d9b5] bg-[var(--gold-soft)] px-4 py-3 text-sm text-[var(--gold-ink)]">
          {t("migrationHint")}
        </p>
      ) : visible.length === 0 ? (
        <EmptyState>{insights.length === 0 ? t("empty") : t("noMatch")}</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((insight) => (
            <ProductCard
              key={insight.product.id}
              insight={insight}
              stockAlert={alertIds.has(insight.product.id)}
              period={period}
            />
          ))}
        </div>
      )}
    </div>
  );
}
