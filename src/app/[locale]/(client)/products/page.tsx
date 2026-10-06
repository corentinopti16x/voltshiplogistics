import { getTranslations } from "next-intl/server";
import { getAuthContext } from "@/lib/auth/context";
import { listRestockAlerts } from "@/lib/products/queries";
import { loadProductInsights, type ProductInsight } from "@/lib/products/overview";
import { ProductCard } from "@/components/client/product-card";
import { ProductFilters } from "@/components/client/product-filters";
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
  }>;
}) {
  const t = await getTranslations("products");
  const ctx = await getAuthContext();
  const filters = await searchParams;
  const q = (filters.q ?? "").trim().toLowerCase();
  const lifecycle = filters.lifecycle ?? "";
  const sourcing = filters.sourcing ?? "";
  const sort = filters.sort ?? "sales90";
  const minSalesRaw = filters.min ?? "";
  const minSales = Math.max(0, Number(minSalesRaw) || 0);

  let insights: ProductInsight[] = [];
  let alertIds = new Set<string>();
  let loadError = false;
  if (ctx?.clientId) {
    try {
      const overview = await loadProductInsights(ctx.clientId);
      insights = overview.insights;
      const alerts = await listRestockAlerts(ctx.clientId, overview.products);
      alertIds = new Set(alerts.map((alert) => alert.product.id));
    } catch {
      loadError = true;
    }
  }

  const visible = insights.filter(({ product, sourcingOpen }) => {
    if (q && !product.title.toLowerCase().includes(q)) return false;
    if (lifecycle && product.lifecycle_status !== lifecycle) return false;
    if (sourcing === "open") return sourcingOpen;
    if (sourcing && product.sourcing_status !== sourcing) return false;
    return true;
  }).filter((row) => (minSales > 0 ? (row.metrics?.units90 ?? 0) >= minSales : true));

  const num = (value: number | null | undefined, empty: number) =>
    value == null || !Number.isFinite(value) ? empty : value;
  visible.sort((a, b) => {
    switch (sort) {
      case "sales30":
        return num(b.metrics?.units30, -1) - num(a.metrics?.units30, -1);
      case "salesLow":
        return num(a.metrics?.units90, 0) - num(b.metrics?.units90, 0);
      case "profit":
        return num(b.economics.profit, -Infinity) - num(a.economics.profit, -Infinity);
      case "price":
        return num(b.product.selling_price, -1) - num(a.product.selling_price, -1);
      case "newest":
        return (b.product.created_at ?? "").localeCompare(a.product.created_at ?? "");
      case "name":
        return a.product.title.localeCompare(b.product.title);
      default:
        return num(b.metrics?.units90, -1) - num(a.metrics?.units90, -1);
    }
  });

  const counts = {
    all: insights.length,
    testing: insights.filter((row) => row.product.lifecycle_status === "testing").length,
    winning: insights.filter((row) => row.product.lifecycle_status === "winning").length,
    declining: insights.filter((row) => row.product.lifecycle_status === "declining").length,
    dead: insights.filter((row) => row.product.lifecycle_status === "dead").length,
  };

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

      <ProductFilters
        q={q}
        lifecycle={lifecycle}
        sourcing={sourcing}
        sort={sort}
        minSales={minSalesRaw}
        counts={counts}
      />

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
            />
          ))}
        </div>
      )}
    </div>
  );
}
