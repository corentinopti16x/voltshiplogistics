import type { ReactNode } from "react";
import { loadQuoteQueue } from "@/lib/products/queue";
import { queuePosition } from "@/lib/products/queue-core";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { redirect, Link } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPricingSettings } from "@/lib/pricing/settings";
import { getProductRequest, type ProductRow } from "@/lib/products/types";
import { ProductPhoto } from "@/components/client/product-photo";
import { SourcerShell } from "@/components/sourcer/sourcer-shell";
import { SourcingWorkForm } from "@/components/sourcer/sourcing-work-form";
import { AnnouncedPricesForm } from "@/components/sourcer/announced-prices-form";
import { AnnouncedKitPricesForm } from "@/components/sourcer/announced-kit-prices-form";
import { calculateProductCogsMatrix, getProductMarkets } from "@/lib/pricing/server";
import { matrixViews } from "@/lib/pricing/matrix-view";
import { gridVersionDate } from "@/lib/domain/pricing";
import { parseFinancialProfile } from "@/lib/domain/economics";
import { packPieces } from "@/lib/products/extras";
import { CarrierSelector } from "@/components/client/carrier-selector";
import { CogsMatrix } from "@/components/client/cogs-matrix";
import { UpsellsPanel } from "@/components/products/upsells-panel";
import { UpsellComposer } from "@/components/products/upsell-composer";
import { clientProducts, loadUpsells, stockBySku, suggestUpsells } from "@/lib/products/upsells-server";
import { composerItem, upsellParentsOf } from "@/lib/products/upsells";
import { unitsSold90d } from "@/lib/products/sales90";
import { loadClientSalesVariants, loadSevenDayTrends } from "@/lib/products/sales7-server";
import { SalesTrendBadge } from "@/components/sourcer/sales-trend-badge";
import { BuyAdvice } from "@/components/sourcer/buy-advice";
import { loadProductBuyLines } from "@/lib/orders/to-ship-server";
import { DEFAULT_BUY_OPTIONS } from "@/lib/orders/to-ship";
import { productSkuKeys } from "@/lib/products/sales90";

export default async function SourcerProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: "en" | "fr"; id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ locale, id }, { from }] = await Promise.all([params, searchParams]);
  const ctx = await getAuthContext();
  if (!ctx) {
    redirect({ href: "/staff/login", locale });
    return null;
  }
  if (ctx.role !== "sourcer" && ctx.role !== "voltship_admin") {
    redirect({ href: "/home", locale });
    return null;
  }

  const t = await getTranslations("sourcer.product");
  const tQueue = await getTranslations("sourcer.queue");
  const admin = createAdminClient();
  const settings = await readPricingSettings(admin);
  const [{ data: productData }, { data: work }] = await Promise.all([
    admin
      .from("products_cache")
      .select("*, clients!inner(name, code, financial_profile_json)")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("sourcing_work")
      .select(
        "factory_purchase_price, supplier_name, supplier_contact, sourcing_location, internal_notes, flagged_reason",
      )
      .eq("product_id", id)
      .maybeSingle(),
  ]);
  if (!productData) notFound();
  const product = productData as ProductRow & {
    clients: { name: string; code: string | null; financial_profile_json: unknown };
  };
  const request = getProductRequest(product);
  // Same engine and carrier choice as the client's product page: the line shown per market
  // is the one priced in the COGS (and the one ECCANG must use).
  const matrix = await calculateProductCogsMatrix(product).catch(() => null);
  const views = matrix ? matrixViews(matrix) : null;
  const tCarrier = await getTranslations("sourcer.carrier");
  // Upsells: linked ones (with stock, to keep them in stock), co-purchase suggestions, all
  // products of the client for a manual link.
  const [upsells, suggestions, candidates, mainStock] = await Promise.all([
    loadUpsells(product).catch(() => []),
    suggestUpsells(product, 30).catch(() => ({ mainOrders: 0, items: [] })),
    clientProducts(product.client_id).catch(() => []),
    product.sku ? stockBySku(product.client_id, [product.sku]).catch(() => new Map<string, number>()) : new Map<string, number>(),
  ]);
  // What it sells: last 7 days (vs the 7 before) and 90 days, so the sourcer knows the stakes.
  const salesVariants = await loadClientSalesVariants(product.client_id).catch(() => []);
  const trend = (await loadSevenDayTrends([product], salesVariants).catch(() => new Map())).get(product.id);
  const sales90 = unitsSold90d([product], salesVariants).get(product.id) ?? 0;
  // How many to buy: same plan as admin « Achats & expéditions », this product's SKUs only
  // (orders of the last 60 days still to send + sales × (lead + cover) − stock − incoming).
  const skuKeys = productSkuKeys([product], salesVariants).get(product.id) ?? new Set<string>();
  const buyLines = await loadProductBuyLines(product.client_id, product.id, skuKeys).catch(() => []);

  const place = queuePosition(await loadQuoteQueue().catch(() => []), product.id);

  return (
    <SourcerShell role={ctx.role}>
      <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--card)]/95 px-4 py-3 ring-1 ring-[var(--line)] backdrop-blur">
        <div className="flex items-center gap-4">
    <Link
            href={from === "todo" ? "/admin/todo" : "/sourcer"}
            className="text-sm text-[var(--muted)] hover:text-[var(--ink)]"
          >
            {from === "todo" ? t("backToTodo") : t("backToQueue")}
          </Link>
          <span className="text-sm font-semibold">
            {place.position
              ? t("queue.position", { position: place.position, total: place.total })
              : t("queue.outside", { total: place.total })}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {place.previous ? (
            <Link
              href={`/sourcer/${place.previous.id}`}
              className="rounded-lg px-3 py-1.5 font-medium ring-1 ring-[var(--line)] hover:ring-[var(--navy)]"
            >
              {t("queue.previous")}
            </Link>
          ) : null}
          {place.next ? (
            <Link
              href={`/sourcer/${place.next.id}`}
              title={place.next.title}
              className="max-w-xs truncate rounded-lg bg-[var(--navy)] px-3 py-1.5 font-semibold text-white hover:opacity-90"
            >
              {t("queue.next", { title: place.next.title })}
            </Link>
          ) : (
            <span className="text-[var(--muted)]">{t("queue.last")}</span>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <ProductPhoto
          src={product.photo_url}
          alt={product.title}
          className="h-40 w-40 rounded-2xl"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-[var(--muted)]">
            {product.clients.name} · {product.sku ?? t("noSku")}
          </p>
          <h1 className="font-display mt-1 text-3xl">{product.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <SalesTrendBadge trend={trend} locale={locale} size="lg" />
            <span className="text-xs text-[var(--muted)]">{t("sales90", { count: sales90.toLocaleString(locale) })}</span>
          </div>
        </div>
        <span className="rounded-full bg-[var(--card)] px-3 py-1 text-xs ring-1 ring-[var(--line)]">
          {tQueue(`statuses.${product.sourcing_status ?? "brief_received"}`)}
        </span>
      </div>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">{t("clientBrief")}</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <Item label={t("description")} value={request.description} />
          <Item label={t("targetUnitPrice")} value={request.target_unit_price} />
          <Item label={t("approxWeight")} value={request.approx_weight_g} />
          <Item label={t("currentUnitCost")} value={request.current_unit_cost} />
          <Item label={t("launchQty")} value={request.expected_launch_qty} />
          <Item label={t("destinationMarkets")} value={request.destination_markets} />
          <Item label={t("notes")} value={request.notes} />
          {request.source_url ? (
            <div>
              <dt className="text-xs text-[var(--muted)]">{t("reference")}</dt>
              <dd className="mt-1">
                <a
                  href={request.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {t("openSourceLink")}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <div className="mt-6">
        <SourcingWorkForm
          product={product}
          work={work}
          fxRmbPerEur={settings.fx_rmb_per_eur}
          packagingLadder={settings.packaging_ladder}
        />
      </div>
      <Fold title={tCarrier("title")} hint={tCarrier("lead")}>
        <div id="carrier">
        {!matrix || !views ? (
          <p className="mt-3 text-sm text-[var(--muted)]">{tCarrier("error")}</p>
        ) : matrix.missingReason ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            {matrix.missingReason === "grid" ? tCarrier("missingGrid") : tCarrier("missingProduct")}
          </p>
        ) : (
          <CarrierSelector productId={product.id} markets={views.carrierMarkets} canEdit staff />
        )}
        </div>
      </Fold>

      {matrix && views ? (
        <Fold title={t("folds.cogs")}>
          <CogsMatrix
            markets={views.matrixMarkets}
            quantities={matrix.quantities}
            sellingPrice={product.selling_price}
            profile={parseFinancialProfile(product.clients.financial_profile_json)}
            gridVersion={matrix.activeGridVersion}
            gridDate={matrix.gridEffectiveDate ?? gridVersionDate(matrix.activeGridVersion)}
            ratesChanged={false}
            missingReason={matrix.missingReason}
            packPieces={packPieces(product.quote_json)}
          />
        </Fold>
      ) : null}

      <Fold title={t("folds.upsells")}>
      <div className="mt-6">
        <UpsellsPanel
          product={product}
          upsells={upsells}
          suggestions={suggestions.items}
          mainOrders={suggestions.mainOrders}
          candidates={candidates}
          parents={upsellParentsOf(candidates, product.id)}
        />
      </div>
      {upsells.length > 0 ? (
        <div className="mt-6">
          <UpsellComposer
            productId={product.id}
            main={composerItem(product, product.sku && mainStock.has(product.sku) ? mainStock.get(product.sku) : product.stock_manual)}
            upsells={upsells.map((item) => composerItem(item.product, item.stock))}
            markets={getProductMarkets(product)}
            showStock
          />
        </div>
      ) : null}
      </Fold>

      <Fold title={t("folds.buy")}>
        <BuyAdvice lines={buyLines} locale={locale} coverDays={DEFAULT_BUY_OPTIONS.coverDays} />
      </Fold>

      <Fold title={t("folds.announced")}>
      <div className="mt-6">
        <AnnouncedPricesForm productId={product.id} quoteJson={product.quote_json} markets={getProductMarkets(product)} />
      </div>
      {upsells.length > 0 ? (
        <div className="mt-6">
          <AnnouncedKitPricesForm
            productId={product.id}
            quoteJson={product.quote_json}
            markets={getProductMarkets(product)}
            companions={upsells.map((item) => ({ id: item.product.id, title: item.product.title }))}
          />
        </div>
      ) : null}
      </Fold>
    </SourcerShell>
  );
}

/** A secondary block of the sheet: closed by default, nothing is removed. */
function Fold({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <details className="group mt-4 rounded-2xl border border-[var(--line)] bg-[var(--card)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 text-sm font-semibold">
        <span>
          {title}
          {hint ? <span className="mt-0.5 block text-xs font-normal text-[var(--muted)]">{hint}</span> : null}
        </span>
        <span aria-hidden className="text-[var(--muted)] transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="border-t border-[var(--line)] px-6 pt-2 pb-6">{children}</div>
    </details>
  );
}

function Item({ label, value }: { label: string; value: unknown }) {
  if (value == null || value === "") return null;
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1">{String(value)}</dd>
    </div>
  );
}
