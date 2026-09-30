import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { getProductStockSnapshot, getTenantProduct } from "@/lib/products/queries";
import {
  getProductQuestions,
  getProductRequest,
  getResearchState,
  getRestockRequests,
  isQuoteAccepted,
} from "@/lib/products/types";
import { parseAcceptedQuoteSnapshot } from "@/lib/domain/pricing";
import { calculateLiveProductQuote } from "@/lib/pricing/server";
import { LifecycleBadge } from "@/components/client/lifecycle-badge";
import { SourcingPipeline } from "@/components/client/sourcing-pipeline";
import { EconomicsCalculator } from "@/components/client/economics-calculator";
import { ProductQuoteActions } from "@/components/client/product-quote-actions";
import { ProductResearchActions } from "@/components/client/product-research-actions";
import { ProductStockActions } from "@/components/client/product-stock-actions";
import { LifecycleBanner } from "@/components/client/lifecycle-banner";
import { ProductPhoto } from "@/components/client/product-photo";
import {
  DEFAULT_FINANCIAL_PROFILE,
  parseFinancialProfile,
} from "@/lib/domain/economics";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("products");
  const ctx = await getAuthContext();
  if (!ctx?.clientId) notFound();

  let product;
  try {
    product = await getTenantProduct(ctx.clientId, id);
  } catch {
    notFound();
  }
  if (!product) notFound();

  const request = getProductRequest(product);
  const liveQuote = await calculateLiveProductQuote(product);
  const stock = await getProductStockSnapshot(product);
  const acceptedSnapshot = parseAcceptedQuoteSnapshot(product.accepted_quote_snapshot_json);
  const readyForQuote = liveQuote.breakdown != null;

  let profile = DEFAULT_FINANCIAL_PROFILE;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("clients")
      .select("financial_profile_json")
      .eq("id", ctx.clientId)
      .maybeSingle();
    profile = parseFinancialProfile(data?.financial_profile_json);
  } catch {
    profile = DEFAULT_FINANCIAL_PROFILE;
  }

  const step = product.sourcing_status ?? "brief_received";

  return (
    <div>
      <Link href="/products" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
        ← {t("back")}
      </Link>
      <div className="mt-4 flex flex-wrap items-start gap-6">
        <ProductPhoto
          src={product.photo_url}
          alt={product.title}
          className="h-48 w-full rounded-2xl sm:w-48"
        />
        <div>
          <div className="flex items-center gap-2">
            <LifecycleBadge status={product.lifecycle_status} />
            {product.sku ? (
              <span className="text-xs text-[var(--muted)]">{product.sku}</span>
            ) : null}
          </div>
          <h1 className="font-display mt-2 text-3xl">{product.title}</h1>
        </div>
      </div>

      <LifecycleBanner
        status={product.lifecycle_status}
        productId={product.id}
        daysLeft={stock.daysLeft}
      />

      <SourcingPipeline step={step} />

      <section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">{t("quote.title")}</h2>
        {liveQuote.breakdown ? (
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">{t("quote.product")}</dt>
              <dd>${Number(product.client_price).toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">{t("quote.weight")}</dt>
              <dd>{product.weight_g} g</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Shipping ({liveQuote.destination})</dt>
              <dd>
                ${liveQuote.breakdown.shipping.toFixed(2)} · {liveQuote.breakdown.carrier}
                {liveQuote.breakdown.deliveryRange
                  ? ` · ${liveQuote.breakdown.deliveryRange}`
                  : ""}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Handling & commission</dt>
              <dd>
                $
                {(
                  liveQuote.breakdown.handling + liveQuote.breakdown.commission
                ).toFixed(2)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">{t("quote.lead")}</dt>
              <dd>
                {product.production_lead_days ?? "—"} {t("quote.days")}
              </dd>
            </div>
            <div className="flex justify-between border-t border-[var(--line)] pt-2 font-semibold">
              <dt>COGS / unit</dt>
              <dd>${liveQuote.breakdown.cogs.toFixed(2)}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">
            {liveQuote.missingReason === "grid"
              ? "Pricing grid is not active yet."
              : liveQuote.missingReason === "rate"
                ? `No ${liveQuote.destination} rate matches this weight and channel yet.`
                : t("quote.pending")}
          </p>
        )}
        {acceptedSnapshot ? (
          <div className="mt-4 rounded-xl bg-[var(--bg)] p-4 text-sm">
            <p className="font-medium">
              Accepted COGS: ${acceptedSnapshot.cogs.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Frozen on {new Date(acceptedSnapshot.acceptedAt).toLocaleDateString()} · grid{" "}
              {acceptedSnapshot.gridVersion}
              {liveQuote.activeGridVersion &&
              liveQuote.activeGridVersion !== acceptedSnapshot.gridVersion
                ? " · Rates have changed since acceptance"
                : ""}
            </p>
          </div>
        ) : null}
        {request.description ? (
          <p className="mt-4 text-sm text-[var(--muted)]">{request.description}</p>
        ) : null}
        <ProductQuoteActions
          productId={product.id}
          ready={readyForQuote}
          accepted={isQuoteAccepted(product)}
          questions={getProductQuestions(product)}
        />
      </section>

      <div className="mt-6">
        <EconomicsCalculator
          productId={product.id}
          initialPrice={product.selling_price}
          cogs={liveQuote.breakdown?.cogs ?? null}
          profile={profile}
        />
      </div>

      <section id="stock" className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">{t("stock.title")}</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-[var(--muted)]">{t("stock.available")}</dt>
            <dd className="font-medium">{stock.qtyAvailable}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Sales / day</dt>
            <dd className="font-medium">{stock.salesPerDay.toFixed(1)}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Days left</dt>
            <dd className="font-medium">
              {stock.daysLeft == null ? "—" : stock.daysLeft.toFixed(0)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Inbound</dt>
            <dd className="font-medium">{stock.inboundQty}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Status</dt>
            <dd className="font-medium capitalize">{stock.status.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Suggested reorder</dt>
            <dd className="font-medium">{stock.suggestedQty}</dd>
          </div>
        </dl>
        {stock.status === "out_of_stock" && stock.stockoutSince ? (
          <p className="mt-3 text-sm text-amber-900">
            {t("stock.stockout", {
              date: new Date(`${stock.stockoutSince}T00:00:00`).toLocaleDateString(),
              units: stock.lostUnits ?? 0,
            })}
          </p>
        ) : null}
        <ProductStockActions
          productId={product.id}
          requests={getRestockRequests(product)}
          suggestedQty={stock.suggestedQty}
        />
      </section>

      <section id="research" className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">{t("research.title")}</h2>
        <ProductResearchActions
          productId={product.id}
          research={getResearchState(product)}
          showPack={product.lifecycle_status === "testing"}
          planTier={ctx.client?.plan_tier ?? "bronze"}
        />
      </section>
    </div>
  );
}
