import { getTranslations } from "next-intl/server";
import { refreshUpsellsAction, toggleUpsellAction } from "@/app/actions/upsells";
import { ProductPhoto } from "@/components/client/product-photo";
import { Link } from "@/i18n/routing";
import type { ProductRow } from "@/lib/products/types";
import type { UpsellProduct, UpsellSuggestion } from "@/lib/products/upsells-server";

/**
 * Staff view of a product's upsells: linked upsells (with stock, to keep them in stock),
 * products bought in the same Shopify orders (one click to link), manual add.
 */
export async function UpsellsPanel({
  product,
  upsells,
  suggestions,
  mainOrders,
  candidates,
}: {
  product: ProductRow;
  upsells: UpsellProduct[];
  suggestions: UpsellSuggestion[];
  mainOrders: number;
  candidates: ProductRow[];
}) {
  const t = await getTranslations("sourcer.upsells");
  const linked = new Set(upsells.map((item) => item.product.id));
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6" id="upsells">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{t("title")}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{t("lead")}</p>
        </div>
        <form action={refreshUpsellsAction}>
          <input type="hidden" name="client_id" value={product.client_id} />
          <button className="cursor-pointer rounded-md border border-[var(--line)] px-2.5 py-1 text-xs">{t("refresh")}</button>
        </form>
      </div>

      {upsells.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">{t("none")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {upsells.map(({ product: upsell, stock, source, orders }) => (
            <li key={upsell.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
              <ProductPhoto src={upsell.photo_url} alt={upsell.title} className="h-10 w-10 rounded-md" />
              <div className="min-w-0 flex-1">
                <Link href={`/sourcer/${upsell.id}`} className="font-medium hover:underline">
                  {upsell.title}
                </Link>
                <p className="text-xs text-[var(--muted)]">
                  {upsell.sku ?? t("noSku")} · {upsell.client_price != null ? `${Number(upsell.client_price).toFixed(2)} €` : t("noPrice")} ·{" "}
                  {upsell.weight_g != null ? `${upsell.weight_g} g` : t("noWeight")} ·{" "}
                  {source === "auto" ? t("sourceAuto", { orders: orders ?? 0 }) : t("sourceManual")}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  stock == null ? "bg-[var(--card-soft)] text-[var(--muted)]" : stock > 0 ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"
                }`}
              >
                {stock == null ? t("stockUnknown") : t("stock", { count: stock })}
              </span>
              <form action={toggleUpsellAction}>
                <input type="hidden" name="product_id" value={product.id} />
                <input type="hidden" name="upsell_id" value={upsell.id} />
                <input type="hidden" name="op" value="remove" />
                <button className="cursor-pointer rounded-md border border-[var(--line)] px-2 py-1 text-xs">{t("remove")}</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-5 text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
        {t("suggestionsTitle", { orders: mainOrders })}
      </h3>
      {suggestions.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">{mainOrders === 0 ? t("noOrders") : t("noSuggestion")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {suggestions.map((item) => (
            <li key={item.sku} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {item.product?.title ?? item.title ?? item.sku}
                <span className="ml-2 text-xs text-[var(--muted)]">
                  {item.sku} · {t("together", { orders: item.orders, rate: Math.round(item.rate * 100) })}
                </span>
              </span>
              {item.product ? (
                <form action={toggleUpsellAction}>
                  <input type="hidden" name="product_id" value={product.id} />
                  <input type="hidden" name="upsell_id" value={item.product.id} />
                  <button className="cursor-pointer rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs text-white">{t("add")}</button>
                </form>
              ) : (
                <span className="text-xs text-[var(--rust-ink)]">{t("noProduct")}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <form action={toggleUpsellAction} className="mt-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="product_id" value={product.id} />
        <select name="upsell_id" required defaultValue="" className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-white px-2 py-1.5 text-sm">
          <option value="">{t("pick")}</option>
          {candidates
            .filter((row) => row.id !== product.id && !linked.has(row.id))
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((row) => (
              <option key={row.id} value={row.id}>
                {row.title}
                {row.sku ? ` (${row.sku})` : ""}
              </option>
            ))}
        </select>
        <button className="cursor-pointer rounded-md border border-[var(--line)] px-3 py-1.5 text-sm">{t("addManual")}</button>
      </form>
    </section>
  );
}
