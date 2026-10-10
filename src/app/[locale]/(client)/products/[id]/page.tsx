import { notFound } from "next/navigation";
import { listClientPurchaseOrders } from "@/lib/purchase-orders/queries";
import { PurchaseOrderCard } from "@/components/orders/purchase-order-card";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getAuthContext, isTenantUser } from "@/lib/auth/context";
import { getProductStockSnapshot, getTenantProduct } from "@/lib/products/queries";
import { isClientEccangEnabled } from "@/lib/eccang/queries";
import {
  getProductQuestions,
  getProductRequest,
  getRestockRequests,
  isMigratedProduct,
  isQuoteAccepted,
  simpleStage,
} from "@/lib/products/types";
import {
  formatWeightTier,
  gridVersionDate,
  parseAcceptedQuoteSnapshot,
  ratesChangedSinceQuote,
} from "@/lib/domain/pricing";
import { calculateProductCogsMatrix, liveQuoteFromMatrix } from "@/lib/pricing/server";
import { calculateProductEstimate } from "@/lib/products/overview";
import { loadShopifyImagesForProducts } from "@/lib/shopify/images";
import { loadClientRecurrence } from "@/lib/shopify/recurrence";
import { CogsMatrix, type CogsMatrixMarketView } from "@/components/client/cogs-matrix";
import { CarrierSelector, type CarrierSelectorMarket } from "@/components/client/carrier-selector";
import { ProductImageCarousel } from "@/components/client/product-image-carousel";
import { LifecycleBadge } from "@/components/client/lifecycle-badge";
import { SourcingPipeline } from "@/components/client/sourcing-pipeline";
import { EconomicsCalculator } from "@/components/client/economics-calculator";
import { ProductQuoteActions } from "@/components/client/product-quote-actions";
import { ProductStockActions } from "@/components/client/product-stock-actions";
import { LifecycleBanner } from "@/components/client/lifecycle-banner";
import { ProductPhoto } from "@/components/client/product-photo";
import {
  DEFAULT_FINANCIAL_PROFILE,
  parseFinancialProfile,
} from "@/lib/domain/economics";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge, Card, PageBand, SectionTitle } from "@/components/ui";
import { formatAmount, formatDate, formatDays, formatNumber, formatPercent, formatRatio } from "@/lib/format";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [t, locale] = await Promise.all([getTranslations("products"), getLocale()]);
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
  const [matrix, stock, shopifyImages, recurrence, warehouseLive, purchaseOrders] = await Promise.all([
    calculateProductCogsMatrix(product),
    getProductStockSnapshot(product),
    loadShopifyImagesForProducts(ctx.clientId, [product]).catch(() => new Map<string, string[]>()),
    loadClientRecurrence(ctx.clientId, product.sku ? [product.sku] : []).catch(() => null),
    isClientEccangEnabled(ctx.clientId),
    listClientPurchaseOrders(ctx.clientId, { productId: product.id, limit: 5 }).catch(() => []),
  ]);
  const liveQuote = liveQuoteFromMatrix(matrix);
  const acceptedSnapshot = parseAcceptedQuoteSnapshot(product.accepted_quote_snapshot_json);
  const readyForQuote = liveQuote.breakdown != null;
  const images = shopifyImages.get(product.id) ?? [];
  const productRecurrence = product.sku ? recurrence?.products.get(product.sku) ?? null : null;
  const matrixMarkets: CogsMatrixMarketView[] = matrix.markets.map((market) => ({
    destination: market.destination,
    cells: market.cells.map((cell) => ({
      quantity: cell.quantity,
      cogs: cell.breakdown?.cogs ?? null,
      cogsPerUnit: cell.breakdown?.cogsPerUnit ?? null,
      weightG: cell.breakdown?.weightG ?? null,
      billedWeightG: cell.breakdown?.billedWeightG ?? null,
      iossRequired: cell.breakdown?.iossRequired === true,
      carrier: cell.breakdown?.carrier ?? null,
      lineName: cell.breakdown?.lineName ?? null,
      weightMinG: cell.breakdown?.weightMinG ?? null,
      weightMaxG: cell.breakdown?.weightMaxG ?? null,
      shipping: cell.breakdown?.shipping ?? null,
      deliveryRange: cell.breakdown?.deliveryRange ?? null,
    })),
  }));

  // Carrier line per market: options at the single-unit billed weight, blocked lines removed.
  const carrierMarkets: CarrierSelectorMarket[] = matrix.markets.map((market) => ({
    destination: market.destination,
    options: market.options,
    preference: market.preference,
    forced: market.forced,
    selectionReason: market.cells.find((cell) => cell.quantity === 1)?.breakdown?.selectionReason ?? null,
  }));
  const canChooseCarrier = isTenantUser(ctx);

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
  const breakdown = liveQuote.breakdown;
  // Early estimate from the brief (approx weight × suggested channel × current cost),
  // shown only while there is neither a live nor an accepted quote.
  const estimate =
    breakdown == null && acceptedSnapshot == null
      ? await calculateProductEstimate(product, { profile })
      : null;
  const lowStock = stock.status !== "ok";
  const costLines = breakdown
    ? [
        {
          key: "product",
          label: t("quote.product"),
          note: t("quote.productNote"),
          detail: null as string | null,
          badge: null as string | null,
          hint: null as string | null,
          value: Number(product.client_price),
        },
        {
          key: "shipping",
          label: t("quote.shippingLine"),
          note: `${liveQuote.destination} · ${breakdown.carrier} · ${breakdown.weightG} g${
            breakdown.billedWeightG !== breakdown.weightG
              ? ` · ${t("quote.billedWeight", { weight: breakdown.billedWeightG })}`
              : ""
          }`,
          // Carrier + line, weight tier, parcel price and delivery range always come from the grid cell.
          detail: t("quote.shippingDetail", {
            carrier: breakdown.carrier,
            line: breakdown.lineName ? ` ${breakdown.lineName}` : "",
            tier: formatWeightTier(breakdown.weightMinG, breakdown.weightMaxG),
            price: formatAmount(breakdown.shippingBase, locale),
            delivery: breakdown.deliveryRange ? ` · ${breakdown.deliveryRange}` : "",
          }),
          // IOSS: Voltship's number for every EU parcel — nothing for the client to provide.
          badge: null,
          hint:
            breakdown.selectionReason === "fallback_preferred_unavailable"
              ? t("carrier.fallbackHint")
              : breakdown.selectionReason === "preferred"
                ? t("carrier.preferredHint")
                : null,
          value: breakdown.shipping,
        },
        {
          key: "handling",
          label: t("quote.handling"),
          note: t("quote.handlingNote"),
          detail: null,
          badge: null,
          hint: null,
          value: breakdown.handling + breakdown.commission,
        },
      ]
    : [];
  const maxLine = Math.max(1, ...costLines.map((line) => line.value));

  return (
    <div className="flex flex-col gap-5">
      <PageBand className="h-[340px] sm:h-[300px]" />
      <div className="flex flex-wrap items-center gap-5 text-white">
        {images.length > 0 ? (
          <ProductImageCarousel
            images={images}
            alt={product.title}
            compact
            className="h-24 w-24 shrink-0 rounded-[16px] ring-1 ring-white/20 sm:h-28 sm:w-28"
          />
        ) : (
          <ProductPhoto
            src={product.photo_url}
            alt={product.title}
            className="h-24 w-24 shrink-0 rounded-[16px] ring-1 ring-white/20 sm:h-28 sm:w-28"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Link
            href="/products"
            className="self-start text-[13px] font-semibold text-white/75 hover:text-white"
          >
            ← {t("back")}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <LifecycleBadge status={product.lifecycle_status} />
            <Badge tone="outline" className="!border-white/25 !bg-white/12 !text-white">
              {isMigratedProduct(product) ? `✓ ${t("live")}` : t(`simpleStage.${simpleStage(step)}`)}
            </Badge>
            {product.sku ? <span className="text-[12px] text-white/70">{product.sku}</span> : null}
          </div>
          <h1 className="font-display text-[clamp(26px,3.6vw,40px)] leading-[1.1] font-extrabold tracking-[-0.02em]">
            {product.title}
          </h1>
          {request.description ? (
            <p className="line-clamp-2 max-w-2xl text-[14px] text-white/80">{request.description}</p>
          ) : null}
        </div>
      </div>

      <LifecycleBanner
        status={product.lifecycle_status}
        productId={product.id}
        daysLeft={stock.daysLeft}
      />

      <Card as="section" padding="md">
        <SourcingPipeline step={step} migrated={isMigratedProduct(product)} />
      {product.sku?.toUpperCase().startsWith("VS-") && !isMigratedProduct(product) ? (
        <p className="rounded-xl border border-[var(--blue-soft)] bg-[var(--blue-soft)]/40 px-4 py-3 text-[13px]">
          {t.rich("skuNotice", { sku: product.sku, b: (chunks) => <strong className="font-mono">{chunks}</strong> })}
        </p>
      ) : null}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          {/* Quote / COGS — calculateLiveProductQuote (rate grid) + accepted snapshot */}
          <Card as="section" padding="md">
            <SectionTitle
              aside={
                acceptedSnapshot ? (
                  <Badge tone="gold">{t("quote.acceptedBadge")}</Badge>
                ) : breakdown ? (
                  <Badge tone="grey">{t("quote.estimateBadge")}</Badge>
                ) : (
                  <Badge tone="grey">{t("quote.pendingBadge")}</Badge>
                )
              }
            >
              {t("quote.title")}
            </SectionTitle>
            {breakdown ? (
              <div className="mt-4 flex flex-col gap-3">
                {costLines.map((line) => (
                  <div key={line.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex w-[150px] shrink-0 flex-col">
                      <span className="text-[14px] font-semibold">{line.label}</span>
                      <span className="truncate text-[12px] text-[var(--faint)]">{line.note}</span>
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--line-soft)]" aria-hidden>
                      <span
                        className={`block h-full rounded-full ${
                          line.key === "product"
                            ? "bg-[#1B4677]"
                            : line.key === "shipping"
                              ? "bg-[#5C8BC7]"
                              : "bg-[var(--gold)]"
                        }`}
                        style={{ width: `${Math.round((line.value / maxLine) * 100)}%` }}
                      />
                    </span>
                    <span className="tabular w-[84px] shrink-0 text-right text-[14px] font-bold">
                      {formatAmount(line.value, locale)}
                    </span>
                    {line.detail ? (
                      <span className="basis-full text-[12px] text-[var(--muted)]">
                        {line.detail}
                        {line.badge ? (
                          <Badge tone="blue" className="ml-2 align-middle">
                            {line.badge}
                          </Badge>
                        ) : null}
                        {line.hint ? <span className="ml-2 text-[var(--faint)]">{line.hint}</span> : null}
                      </span>
                    ) : null}
                  </div>
                ))}
                <div className="flex items-baseline justify-between border-t border-[var(--line-soft)] pt-3">
                  <span className="text-[14px] font-bold">
                    {t("quote.cogsUnit")}
                    <span className="ml-2 text-[12px] font-semibold text-[var(--faint)]">
                      {t("quote.lead")}: {product.production_lead_days ?? "—"} {t("quote.days")}
                    </span>
                  </span>
                  <span className="font-display tabular text-[24px] font-extrabold">
                    {formatAmount(breakdown.cogs, locale)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--muted)]">
                {liveQuote.missingReason === "grid"
                  ? t("quote.missingGrid")
                  : liveQuote.missingReason === "rate"
                    ? t("quote.missingRate", { destination: liveQuote.destination })
                    : t("quote.pending")}
              </p>
            )}
            {estimate ? (
              <div className="mt-4 rounded-[12px] border border-dashed border-[var(--line)] bg-[var(--card-soft)] px-4 py-3 text-sm text-[var(--muted)]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {t("quote.earlyTitle")}
                    <Badge tone="outline" className="ml-2 align-middle">
                      {t("quote.earlyBadge")}
                    </Badge>
                  </span>
                  {estimate.cogs != null ? (
                    <span className="font-display tabular text-[22px] font-extrabold italic">
                      ≈ {formatAmount(estimate.cogs, locale)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[12px]">
                  {estimate.missingReason === "grid"
                    ? t("quote.earlyMissingGrid")
                    : estimate.missingReason === "rate"
                      ? t("quote.earlyMissingRate")
                      : t("quote.earlyLead", {
                          channel: t(`quote.channels.${estimate.basis.channel}`),
                          weight: estimate.basis.weightG,
                          cost: formatAmount(estimate.basis.unitCost, locale),
                          source:
                            estimate.basis.unitCostSource === "current_unit_cost"
                              ? t("quote.earlySourceCurrent")
                              : t("quote.earlySourceTarget"),
                        })}
                </p>
                {estimate.cogs != null ? (
                  <p className="mt-1 text-[12px] italic">
                    {product.selling_price
                      ? t("quote.earlyRoas", {
                          be: formatRatio(estimate.economics.roasBe, locale),
                          target: formatRatio(estimate.economics.roasTarget, locale),
                        })
                      : t("quote.earlyNoPrice")}
                  </p>
                ) : null}
              </div>
            ) : null}
            {acceptedSnapshot ? (
              <div className="mt-4 rounded-[12px] bg-[var(--gold-soft)] px-4 py-3 text-sm text-[var(--gold-ink)]">
                <p className="font-semibold">
                  {t("quote.acceptedCogs", { cogs: formatAmount(acceptedSnapshot.cogs, locale) })}
                </p>
                <p className="mt-0.5 text-[12px]">
                  {t("quote.frozenOn", {
                    date: formatDate(acceptedSnapshot.acceptedAt, locale),
                    grid: acceptedSnapshot.gridVersion,
                  })}
                  {ratesChangedSinceQuote(acceptedSnapshot, breakdown, liveQuote.activeGridVersion)
                    ? ` · ${t("quote.ratesChanged")}`
                    : ""}
                </p>
                <p className="mt-0.5 text-[12px]">
                  {t("quote.shippingDetail", {
                    carrier: acceptedSnapshot.carrier,
                    line: acceptedSnapshot.lineName ? ` ${acceptedSnapshot.lineName}` : "",
                    tier: formatWeightTier(acceptedSnapshot.weightMinG, acceptedSnapshot.weightMaxG),
                    price: formatAmount(acceptedSnapshot.shippingBase, locale),
                    delivery: acceptedSnapshot.deliveryRange ? ` · ${acceptedSnapshot.deliveryRange}` : "",
                  })}
                </p>
              </div>
            ) : null}
            <ProductQuoteActions
              productId={product.id}
              ready={readyForQuote}
              accepted={isQuoteAccepted(product)}
              questions={getProductQuestions(product)}
            />
          </Card>

          {/* Carrier line per market — quote_json._carrier_pref + clients.carrier_rules_json */}
          {matrix.missingReason == null ? (
            <Card as="section" padding="md" id="carrier">
              <SectionTitle>{t("carrier.title")}</SectionTitle>
              <p className="mt-1 text-[13px] text-[var(--muted)]">{t("carrier.lead")}</p>
              <CarrierSelector productId={product.id} markets={carrierMarkets} canEdit={canChooseCarrier} />
            </Card>
          ) : null}

          <CogsMatrix
            markets={matrixMarkets}
            quantities={matrix.quantities}
            sellingPrice={product.selling_price}
            profile={profile}
            gridVersion={matrix.activeGridVersion}
            gridDate={matrix.gridEffectiveDate ?? gridVersionDate(matrix.activeGridVersion)}
            ratesChanged={ratesChangedSinceQuote(
              acceptedSnapshot,
              breakdown,
              liveQuote.activeGridVersion,
            )}
            missingReason={matrix.missingReason}
          />

          <EconomicsCalculator
            productId={product.id}
            initialPrice={product.selling_price}
            cogs={breakdown?.cogs ?? null}
            profile={profile}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {purchaseOrders.length > 0 ? (
            <div className="flex flex-col gap-3" id="orders">
              {purchaseOrders.map((order) => (
                <PurchaseOrderCard key={order.id} order={order} locale={locale === "fr" ? "fr" : "en"} />
              ))}
            </div>
          ) : null}
          {/* Stock — getProductStockSnapshot (stock_cache + sales_cache + safety stock) */}
          <Card as="section" padding="md" id="stock">
            <SectionTitle
              aside={
                <span
                  className={`font-display text-[20px] font-extrabold ${
                    lowStock ? "text-[var(--rust-ink)]" : "text-[var(--ink)]"
                  }`}
                >
                  {stock.daysLeft == null
                    ? "—"
                    : t("stock.daysValue", { days: formatDays(stock.daysLeft, locale) })}
                </span>
              }
            >
              {warehouseLive ? t("stock.warehouseTitle") : t("stock.declaredTitle")}
            </SectionTitle>
            {/* ECCANG: stock_cache is written by pullInventory when the client is enabled */}
            <div className="mt-2">
              {warehouseLive ? (
                <Badge tone="green" dot>
                  {t("stock.liveBadge")}
                </Badge>
              ) : (
                <Badge tone="outline">{t("stock.declaredBadge")}</Badge>
              )}
            </div>
            <div className="mt-3 flex gap-[3px]" aria-hidden>
              {Array.from({ length: 20 }, (_, index) => {
                const filled =
                  stock.daysLeft == null ? 20 : Math.min(20, Math.round(stock.daysLeft / 3));
                return (
                  <span
                    key={index}
                    className={`h-[14px] flex-1 rounded-[3px] ${
                      index < filled
                        ? lowStock
                          ? "bg-[#E07B45]"
                          : "bg-[var(--gold)]"
                        : index === 6
                          ? "bg-[#C9D6E8]"
                          : "bg-[var(--line-soft)]"
                    }`}
                  />
                );
              })}
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2">
              <StockCell label={t("stock.available")} value={formatNumber(stock.qtyAvailable, locale)} />
              <StockCell label={t("stock.reserved")} value={formatNumber(stock.qtyReserved, locale)} />
              <StockCell label={t("stock.inbound")} value={formatNumber(stock.inboundQty, locale)} />
              <StockCell label={t("stock.salesDay")} value={formatNumber(stock.salesPerDay, locale, 1)} />
              <StockCell label={t("stock.status")} value={t(`stock.statuses.${stock.status}`)} />
              <StockCell label={t("stock.suggested")} value={formatNumber(stock.suggestedQty, locale)} />
            </dl>
            {/* Réachat — loadClientRecurrence (shopify_orders_cache.customer_key) */}
            <p className="mt-3 text-[13px] text-[var(--muted)]">
              <span className="font-semibold text-[var(--ink)]">{t("recurrence.label")}</span>{" "}
              {!recurrence || !recurrence.shopConnected ? (
                <Link href="/settings" className="font-semibold text-[var(--blue-ink)] hover:underline">
                  {t("recurrence.connect")}
                </Link>
              ) : !product.sku ? (
                t("recurrence.noSku")
              ) : !productRecurrence || productRecurrence.buyers === 0 ? (
                t("recurrence.noBuyers")
              ) : (
                t("recurrence.value", {
                  rate: formatPercent(productRecurrence.reorderRate, locale),
                  buyers: formatNumber(productRecurrence.buyers, locale),
                  days: productRecurrence.withinDays,
                })
              )}
            </p>
            {stock.status === "out_of_stock" && stock.stockoutSince ? (
              <p className="mt-3 text-sm text-[var(--rust-ink)]">
                {t("stock.stockout", {
                  date: formatDate(`${stock.stockoutSince}T00:00:00`, locale),
                  units: stock.lostUnits ?? 0,
                })}
              </p>
            ) : null}
            <ProductStockActions
              productId={product.id}
              requests={getRestockRequests(product)}
              suggestedQty={stock.suggestedQty}
            />
          </Card>

        </div>
      </div>
    </div>
  );
}

function StockCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] bg-[var(--card-soft)] px-3 py-2">
      <dt className="text-[11px] font-semibold text-[var(--muted)]">{label}</dt>
      <dd className="font-display tabular text-[18px] font-extrabold">{value}</dd>
    </div>
  );
}
