import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";
import { ProductPhoto } from "@/components/client/product-photo";
import { ProductImageCarousel } from "@/components/client/product-image-carousel";
import { SIMPLE_PIPELINE, isMigratedProduct, simpleStage } from "@/lib/products/types";
import type { DashboardPeriod } from "@/lib/products/periods";
import type { ProductInsight } from "@/lib/products/overview";
import { formatAmount, formatNumber } from "@/lib/format";

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
  /** Rolling window shown in the sales band (24 h, 7 d or 30 d). */
  period?: DashboardPeriod;
}) {
  const [t, locale] = await Promise.all([getTranslations("products.card"), getLocale()]);
  const { product, metrics, cogs, cogsLadder, shopifyImages, estimate } = insight;
  // Early estimate (client answers × active grid) — only while no real quote exists.
  const early = estimate && estimate.cogs != null ? estimate : null;
  const migrated = isMigratedProduct(product);
  const stage = simpleStage(product.sourcing_status);
  const stageIndex = SIMPLE_PIPELINE.indexOf(stage);
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
          {insight.quotePending ? <Badge tone="navy">{t("quoteReady")}</Badge> : null}
        </span>
        {lowStock ? (
          <span className="pointer-events-none absolute top-2.5 right-2.5 z-[3]">
            <Badge tone="rust">{t("lowStock")}</Badge>
          </span>
        ) : null}
      </span>

      <span className="flex flex-1 flex-col gap-3 p-4">
        <span className="line-clamp-2 text-[15px] leading-snug font-bold">{product.title}</span>

        {/* COGS 1·2·3·4·5 — live grid on the primary market (calculateProductCogsMatrix) */}
        {cogsLadder.some((step) => step.cogs != null) ? (
          <span className="flex flex-col gap-2 rounded-[10px] bg-[var(--card-soft)] px-3 py-2.5">
            <span className="text-[11px] font-semibold text-[var(--muted)]">
              {t("unitPrice", { market: insight.primaryMarket })}
            </span>
            <span className="tabular text-2xl leading-none font-bold">
              {cogsLadder[0]?.cogs == null ? "—" : formatAmount(cogsLadder[0].cogs, locale)}
            </span>
            <span className="grid grid-cols-4 gap-1 border-t border-[var(--line-soft)] pt-2">
              {cogsLadder.slice(1).map((step) => (
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
        ) : (
          <span className="flex flex-col gap-1 rounded-[10px] bg-[var(--card-soft)] px-3 py-2.5">
            <span className="text-[11px] font-semibold text-[var(--muted)]">
              {t("unitPrice", { market: insight.primaryMarket })}
            </span>
            <span className="tabular text-2xl leading-none font-bold">
              {early?.cogs != null
                ? formatAmount(early.cogs, locale)
                : cogs != null
                  ? formatAmount(cogs, locale)
                  : "—"}
            </span>
            <span className="text-[11px] text-[var(--faint)]">
              {early?.cogs != null ? t("cogsEarlyNote") : cogs != null ? "" : t("pricePending")}
            </span>
          </span>
        )}

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
