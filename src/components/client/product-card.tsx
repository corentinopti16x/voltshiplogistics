import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";
import { Metric } from "@/components/ui/stat";
import { LifecycleBadge } from "@/components/client/lifecycle-badge";
import { ProductPhoto } from "@/components/client/product-photo";
import { ProductImageCarousel } from "@/components/client/product-image-carousel";
import { SIMPLE_PIPELINE, isMigratedProduct, simpleStage } from "@/lib/products/types";
import type { ProductInsight } from "@/lib/products/overview";
import { formatAmount, formatDays, formatNumber, formatRatio } from "@/lib/format";

/**
 * Product card used on the dashboard and the products list.
 * Data: photo/title/lifecycle/sourcing from products_cache, sales + stock from the
 * Shopify caches (getTenantProductMetrics), COGS from the accepted or live quote,
 * margin and ROAS from computeEconomics.
 */
export async function ProductCard({
  insight,
  stockAlert = false,
}: {
  insight: ProductInsight;
  stockAlert?: boolean;
}) {
  const [t, locale] = await Promise.all([getTranslations("products.card"), getLocale()]);
  const { product, metrics, cogs, cogsSource, economics, cogsLadder, shopifyImages, estimate } = insight;
  // Early estimate (client answers × active grid) — only while no real quote exists.
  const early = estimate && estimate.cogs != null ? estimate : null;
  const migrated = isMigratedProduct(product);
  const stage = simpleStage(product.sourcing_status);
  const stageIndex = SIMPLE_PIPELINE.indexOf(stage);
  const sales = (value: number | undefined) =>
    metrics?.units90 == null || value == null ? "—" : formatNumber(value, locale);
  const daysLeft = metrics?.daysLeft ?? null;
  const lowStock = stockAlert || (daysLeft != null && daysLeft < 19 && product.lifecycle_status !== "dead");

  // The whole card is clickable through a stretched link (absolute overlay), so the
  // carousel controls can stay real buttons outside the anchor.
  return (
    <article className="vs-card vs-card-hover relative flex min-w-0 flex-col overflow-hidden text-[var(--ink)]">
      <Link
        href={`/products/${product.id}`}
        className="absolute inset-0 z-[1] rounded-[inherit]"
      >
        <span className="sr-only">{product.title}</span>
      </Link>
      <span className="relative block h-[132px] bg-[var(--bg-deep)]">
        {shopifyImages.length > 0 ? (
          <ProductImageCarousel
            images={shopifyImages}
            alt={product.title}
            compact
            className="h-full w-full"
          />
        ) : (
          <ProductPhoto src={product.photo_url} alt={product.title} className="h-full w-full" />
        )}
        <span className="pointer-events-none absolute top-2.5 left-2.5 z-[3] flex gap-1.5">
          <LifecycleBadge status={product.lifecycle_status} />
          {insight.quotePending ? <Badge tone="navy">{t("quoteReady")}</Badge> : null}
        </span>
        {lowStock ? (
          <span className="pointer-events-none absolute top-2.5 right-2.5 z-[3]">
            <Badge tone="rust">{t("lowStock")}</Badge>
          </span>
        ) : null}
      </span>

      <span className="flex flex-1 flex-col gap-3 p-4">
        <span className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 text-[15px] leading-snug font-bold">{product.title}</span>
          {product.sku ? (
            <span className="shrink-0 text-[11px] text-[var(--faint)]">{product.sku}</span>
          ) : null}
        </span>

        <span className="grid grid-cols-3 gap-x-2 rounded-[10px] bg-[var(--card-soft)] px-2.5 py-2">
          <Metric label={t("sales24h")} value={sales(metrics?.units24h)} />
          <Metric label={t("sales7d")} value={sales(metrics?.units7)} />
          <Metric label={t("sales30d")} value={sales(metrics?.units30)} />
        </span>

        <span className="grid grid-cols-3 gap-x-2 gap-y-2.5">
          <Metric label={t("price")} value={formatAmount(product.selling_price, locale)} />
          <Metric
            label={t("grossMargin")}
            value={formatAmount(economics.profit, locale)}
            tone={economics.profit != null && economics.profit < 0 ? "warning" : "default"}
          />
          <Metric
            label={t("stockDays")}
            value={daysLeft == null ? "—" : t("days", { days: formatDays(daysLeft, locale) })}
            tone={lowStock ? "warning" : "default"}
          />
          {early ? (
            <Metric
              label={t("cogsEarly")}
              tone="muted"
              value={
                <span className="rounded-[6px] border border-dashed border-[var(--line)] px-1.5 italic">
                  ≈ {formatAmount(early.cogs, locale)}
                </span>
              }
            />
          ) : (
            <Metric
              label={cogsSource === "accepted" ? t("cogsReal") : t("cogsEstimate")}
              value={formatAmount(cogs, locale)}
            />
          )}
          <Metric
            label={early ? t("roasEarly") : t("roas")}
            tone={early ? "muted" : "default"}
            value={
              <>
                {formatRatio((early ? early.economics : economics).roasBe, locale)}
                <span className="text-[var(--faint)]"> · </span>
                <span className={early ? "" : "text-[var(--gold-text)]"}>
                  {formatRatio((early ? early.economics : economics).roasTarget, locale)}
                </span>
              </>
            }
          />
        </span>
        {early ? (
          <span className="text-[11px] italic text-[var(--faint)]">{t("cogsEarlyNote")}</span>
        ) : null}

        {/* COGS 1·2·3·4·5 — live grid on the primary market (calculateProductCogsMatrix) */}
        {cogsLadder.some((step) => step.cogs != null) ? (
          <span className="flex flex-col gap-1 rounded-[10px] bg-[var(--card-soft)] px-2.5 py-2">
            <span className="text-[11px] font-semibold text-[var(--muted)]">
              {t("cogsLadder", { market: insight.primaryMarket })}
              {insight.carrierLine ? (
                <span className="font-medium text-[var(--faint)]"> · {t("via", { line: insight.carrierLine })}</span>
              ) : null}
            </span>
            <span className="grid grid-cols-5 gap-1">
              {cogsLadder.map((step) => (
                <span key={step.quantity} className="flex min-w-0 flex-col">
                  <span className="text-[10px] font-bold text-[var(--faint)]">×{step.quantity}</span>
                  <span
                    className="tabular truncate text-[12px] font-bold"
                    title={step.cogs == null ? t("noRate") : undefined}
                  >
                    {step.cogs == null ? "—" : formatAmount(step.cogs, locale)}
                  </span>
                </span>
              ))}
            </span>
          </span>
        ) : null}

        <span className="mt-auto flex flex-col gap-1.5">
          {migrated ? null : (
            <span className="flex gap-[3px]" aria-hidden>
              {SIMPLE_PIPELINE.map((step, index) => (
                <span
                  key={step}
                  className={`h-1 flex-1 rounded-sm ${
                    index <= stageIndex ? "bg-[var(--gold)]" : "bg-[var(--line-soft)]"
                  }`}
                />
              ))}
            </span>
          )}
          <span className="text-[12px] font-semibold text-[var(--muted)]">
            {migrated ? (
              <span className="text-[var(--green-ink,#1F7A4D)]">✓ {t("live")}</span>
            ) : (
              t(`simpleStage.${stage}`)
            )}
            {product.lifecycle_status === "winning" && metrics?.inboundQty ? (
              <span className="text-[var(--faint)]">
                {" "}
                · {t("inbound", { units: formatNumber(metrics.inboundQty, locale) })}
              </span>
            ) : null}
          </span>
        </span>
      </span>
    </article>
  );
}
