import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { getTenantProductMetrics, listTenantProducts } from "@/lib/products/queries";
import { ProductCard } from "@/components/client/product-card";
import { ProductFilters } from "@/components/client/product-filters";
import {
  computeEconomics,
  formatMetric,
  parseFinancialProfile,
} from "@/lib/domain/economics";
import { calculateLiveProductQuote } from "@/lib/pricing/server";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; lifecycle?: string; sourcing?: string }>;
}) {
  const t = await getTranslations("products");
  const ctx = await getAuthContext();
  const filters = await searchParams;
  const q = (filters.q ?? "").trim().toLowerCase();
  const lifecycle = filters.lifecycle ?? "";
  const sourcing = filters.sourcing ?? "";

  let products: Awaited<ReturnType<typeof listTenantProducts>> = [];
  let metrics = new Map<
    string,
    { salesDay: number; units30: number; daysLeft: number | null }
  >();
  const roasByProduct = new Map<string, string | null>();
  let loadError = false;
  if (ctx?.clientId) {
    try {
      products = await listTenantProducts(ctx.clientId);
      const admin = createAdminClient();
      const [{ data: client }, productMetrics, liveQuotes] = await Promise.all([
        admin
          .from("clients")
          .select("financial_profile_json")
          .eq("id", ctx.clientId)
          .maybeSingle(),
        getTenantProductMetrics(ctx.clientId, products),
        Promise.all(products.map((product) => calculateLiveProductQuote(product))),
      ]);
      metrics = productMetrics;
      const profile = parseFinancialProfile(client?.financial_profile_json);
      products.forEach((product, index) => {
        const result = computeEconomics(
          product.selling_price ?? 0,
          liveQuotes[index]?.breakdown?.cogs ?? null,
          profile,
        );
        roasByProduct.set(
          product.id,
          result.roasBe == null ? null : formatMetric(result.roasBe),
        );
      });
    } catch {
      loadError = true;
    }
  }

  const visible = products.filter((product) => {
    if (q && !product.title.toLowerCase().includes(q)) return false;
    if (lifecycle && product.lifecycle_status !== lifecycle) return false;
    if (sourcing && product.sourcing_status !== sourcing) return false;
    return true;
  });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{t("lead")}</p>
        </div>
        <Link
          href="/products/new"
          className="cursor-pointer rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
        >
          {t("new")}
        </Link>
      </div>

      <ProductFilters q={q} lifecycle={lifecycle} sourcing={sourcing} />

      {loadError ? (
        <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t("migrationHint")}
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-8 text-sm text-[var(--muted)]">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((product) => {
            const metric = metrics.get(product.id);
            return (
              <ProductCard
                key={product.id}
                product={product}
                salesDay={`${formatMetric(metric?.salesDay ?? null, 1)} ${t("salesDay")}`}
                daysLeft={`${formatMetric(metric?.daysLeft ?? null, 0)} ${t("daysLeft")}`}
                roasBe={roasByProduct.get(product.id) ?? null}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
