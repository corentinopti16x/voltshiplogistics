"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { composeCogsAction, type ComposeResult } from "@/app/actions/upsells";
import { carrierLineLabel } from "@/lib/domain/carrier-rules";
import { formatAmount } from "@/lib/format";
import { ProductPhoto } from "@/components/client/product-photo";
import type { ComposerItem } from "@/lib/products/upsells";

/**
 * « Composer ma commande » — main product + upsells with quantities → COGS of the parcel
 * (products, one transport at the total weight incl. packaging, handling once).
 */
export function UpsellComposer({
  productId,
  main,
  upsells,
  markets,
  showStock = false,
}: {
  productId: string;
  main: ComposerItem;
  upsells: ComposerItem[];
  markets: string[];
  showStock?: boolean;
}) {
  const t = useTranslations("products.composer");
  const locale = useLocale();
  const [market, setMarket] = useState(markets[0] ?? "FR");
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    // Upsells start at 1 when they can be priced; the others (data missing) at 0.
    Object.fromEntries([[main.id, 1], ...upsells.map((item) => [item.id, item.ready ? 1 : 0])]),
  );
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const selections = Object.entries(quantities).map(([id, quantity]) => ({ productId: id, quantity }));
    const timer = setTimeout(() => {
      startTransition(async () => setResult(await composeCogsAction(productId, market, selections)));
    }, 250);
    return () => clearTimeout(timer);
  }, [productId, market, quantities]);

  const setQuantity = (id: string, value: number) =>
    setQuantities((current) => ({ ...current, [id]: Math.min(20, Math.max(0, Math.round(value) || 0)) }));
  const breakdown = result?.breakdown ?? null;
  const rows = [main, ...upsells];

  return (
    <section className="vs-card p-5 sm:p-6" aria-labelledby="composer-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 id="composer-title" className="font-display text-[19px] font-bold text-[var(--ink)]">
            {t("title")}
          </h2>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">{t("lead")}</p>
        </div>
        {markets.length > 1 ? (
          <label className="flex items-center gap-2 text-[13px]">
            <span className="text-[var(--muted)]">{t("market")}</span>
            <select
              value={market}
              onChange={(event) => setMarket(event.target.value)}
              className="vs-input !py-1 text-[13px]"
            >
              {markets.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        {rows.map((item, index) => (
          <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-[12px] bg-[var(--card-soft)] px-3 py-2">
            <ProductPhoto src={item.photoUrl} alt={item.title} className="h-10 w-10 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold">
                {item.title}
                {index === 0 ? <span className="ml-2 text-[11px] font-medium text-[var(--muted)]">{t("mainBadge")}</span> : null}
              </p>
              <p className="text-[12px] text-[var(--muted)]">
                {item.price != null ? t("unitPrice", { price: formatAmount(item.price, locale) }) : t("noPrice")}
                {item.weightG != null ? ` · ${item.weightG} g` : ""}
                {item.sku ? ` · ${item.sku}` : ""}
                {showStock && item.stock != null ? ` · ${t("stock", { count: item.stock })}` : ""}
              </p>
              {!item.ready ? <p className="text-[12px] text-[var(--rust-ink)]">{t("notReady")}</p> : null}
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <span className="sr-only">{t("quantity")}</span>
              <button
                type="button"
                onClick={() => setQuantity(item.id, (quantities[item.id] ?? 0) - 1)}
                className="h-7 w-7 rounded-md border border-[var(--line)] text-[15px]"
                aria-label={t("less")}
              >
                −
              </button>
              <input
                type="number"
                min={0}
                max={20}
                value={quantities[item.id] ?? 0}
                onChange={(event) => setQuantity(item.id, Number(event.target.value))}
                className="tabular w-12 rounded-md border border-[var(--line)] bg-white px-2 py-1 text-center"
              />
              <button
                type="button"
                onClick={() => setQuantity(item.id, (quantities[item.id] ?? 0) + 1)}
                className="h-7 w-7 rounded-md border border-[var(--line)] text-[15px]"
                aria-label={t("more")}
              >
                +
              </button>
            </label>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-[12px] border border-[var(--line-soft)] px-4 py-3" aria-live="polite">
        {breakdown ? (
          <>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-[var(--muted)]">{t("products", { units: breakdown.units })}</dt>
              <dd className="tabular text-right">{formatAmount(breakdown.product, locale)}</dd>
              {breakdown.box > 0 ? (
                <>
                  <dt className="text-[var(--muted)]">{t("box")}</dt>
                  <dd className="tabular text-right">{formatAmount(breakdown.box, locale)}</dd>
                </>
              ) : null}
              <dt className="text-[var(--muted)]">
                {t("shipping", {
                  line: carrierLineLabel({ carrier: breakdown.carrier, lineName: breakdown.lineName }),
                  content: breakdown.contentWeightG,
                  packaging: breakdown.packagingWeightG,
                  total: breakdown.weightG,
                })}
              </dt>
              <dd className="tabular text-right">{formatAmount(breakdown.shipping, locale)}</dd>
              <dt className="text-[var(--muted)]">{t("handling")}</dt>
              <dd className="tabular text-right">{formatAmount(breakdown.handling + breakdown.commission, locale)}</dd>
            </dl>
            <div className="mt-2 flex items-baseline justify-between border-t border-[var(--line-soft)] pt-2">
              <span className="text-[14px] font-bold">{t("total")}</span>
              <span className="font-display tabular text-[22px] font-extrabold">
                {pending ? "…" : formatAmount(breakdown.cogs, locale)}
              </span>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-[var(--muted)]">
            {pending
              ? t("computing")
              : result?.missingReason === "product_data"
                ? t("missingProduct")
                : result?.missingReason === "rate"
                  ? t("missingRate", { market })
                  : result?.missingReason === "grid"
                    ? t("missingGrid")
                    : t("empty")}
          </p>
        )}
      </div>
    </section>
  );
}
