import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { loadProductMarginMatrix, MarginAccessError } from "@/lib/pricing/margin-server";
import { formatAmount } from "@/lib/format";
import { ConfidentialTag, MarginFlags, Pct, SignedAmount } from "@/components/admin/margin-ui";

export const dynamic = "force-dynamic";

/** Confidential — voltship_admin only: markets × 1..5 with client price vs Voltship cost vs margin. */
export default async function AdminProductMarginPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, rawLocale, ctx] = await Promise.all([
    getTranslations("admin.margin"),
    getLocale(),
    getAuthContext(),
  ]);
  const locale = rawLocale === "fr" ? "fr" : "en";
  if (!ctx || ctx.role !== "voltship_admin") {
    redirect({ href: "/home", locale });
    return null;
  }
  let matrix;
  try {
    matrix = await loadProductMarginMatrix(id);
  } catch (error) {
    if (error instanceof MarginAccessError) {
      redirect({ href: "/home", locale });
      return null;
    }
    throw error;
  }
  if (!matrix) notFound();
  const eur = (value: number | null | undefined) => formatAmount(value, locale);
  const { product, settings } = matrix;

  return (
    <div>
      <Link href={`/admin/clients/${product.client_id}#margin`} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
        ← {t("productPage.back")} · {matrix.clientName}
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">
          {t("productPage.kicker")}
        </p>
        <ConfidentialTag />
      </div>
      <h1 className="font-display mt-2 text-3xl">{product.title}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {product.sku ?? "—"} · {product.weight_g ?? "—"} g · {(product.shipping_channel ?? "—").replaceAll("_", " ")}
        {matrix.activeGridVersion ? ` · ${t("productPage.grid", { version: matrix.activeGridVersion })}` : ""}
      </p>
      <p className="mt-2 text-sm text-[var(--muted)]">{t("productPage.lead")}</p>

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <p className="text-xs text-[var(--muted)]">{t("productPage.factory")}</p>
          <p className="font-display tabular mt-2 text-[26px] font-extrabold">
            {matrix.factoryPriceRmb == null ? "—" : `${matrix.factoryPriceRmb.toFixed(2)} RMB`}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {matrix.factoryPriceEur == null ? t("productPage.factoryMissing") : `≈ ${eur(matrix.factoryPriceEur)} @ ${settings.fx_rmb_per_eur}`}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <p className="text-xs text-[var(--muted)]">{t("productPage.clientPays")} ×1</p>
          <p className="font-display tabular mt-2 text-[26px] font-extrabold">
            {eur(product.client_price == null ? null : Number(product.client_price))}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">client_price</p>
        </div>
        <div className="rounded-2xl border border-[#d8bf76] bg-[#fbf5df] p-5">
          <p className="text-xs text-[var(--muted)]">{t("productPage.margin")} ×1 · {matrix.markets[0]?.destination}</p>
          <p className="font-display tabular mt-2 text-[26px] font-extrabold">
            <SignedAmount value={matrix.markets[0]?.cells[0]?.margin.total ?? null} locale={locale} />
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            <Pct value={matrix.markets[0]?.cells[0]?.margin.pct ?? null} locale={locale} />
          </p>
        </div>
      </section>

      {matrix.markets.map((market) => (
        <section
          key={market.destination}
          className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 p-6">
            <h2 className="text-sm font-semibold">{t("productPage.market", { market: market.destination })}</h2>
            <MarginFlags margin={market.cells[0]} compact />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-y border-[var(--line)] text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">{t("productPage.quantity")}</th>
                  <th className="px-4 py-3 text-right">{t("productPage.clientPays")}</th>
                  <th className="px-4 py-3 text-right">{t("productPage.cost")}</th>
                  <th className="px-4 py-3 text-right">{t("productPage.sourcing")}</th>
                  <th className="px-4 py-3 text-right">{t("productPage.transport")}</th>
                  <th className="px-4 py-3 text-right">{t("productPage.handling")}</th>
                  <th className="px-4 py-3 text-right">{t("productPage.margin")}</th>
                  <th className="px-4 py-3 text-right">{t("productPage.perUnit")}</th>
                  <th className="px-4 py-3 text-right">{t("productPage.pct")}</th>
                  <th className="px-4 py-3 text-right">{t("productPage.fx")}</th>
                </tr>
              </thead>
              <tbody>
                {market.cells.map((cell) => {
                  const noRate = cell.flags.includes("no_rate");
                  return (
                    <tr key={cell.quantity} className="border-b border-[var(--line)]">
                      <td className="px-4 py-3 font-medium">×{cell.quantity}</td>
                      {noRate ? (
                        <td className="px-4 py-3 text-xs text-[var(--muted)]" colSpan={9}>
                          {t("productPage.noRate")}
                        </td>
                      ) : (
                        <>
                          <td className="tabular px-4 py-3 text-right">
                            {eur(cell.clientPays.total)}
                            <span className="block text-[11px] text-[var(--faint)]">
                              {eur(cell.clientPays.product + cell.clientPays.commission)} + {eur(cell.clientPays.shipping)} +{" "}
                              {eur(cell.clientPays.handling)}
                            </span>
                          </td>
                          <td className="tabular px-4 py-3 text-right">
                            {eur(cell.costs.total)}
                            <span className="block text-[11px] text-[var(--faint)]">
                              {cell.costs.factory == null ? "—" : eur(cell.costs.factory)} +{" "}
                              {cell.costs.carrier == null ? "—" : eur(cell.costs.carrier)}
                              {cell.costs.taxPassThrough > 0 ? ` + ${eur(cell.costs.taxPassThrough)}` : ""} +{" "}
                              {eur(cell.costs.handling)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <SignedAmount value={cell.margin.sourcing} locale={locale} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <SignedAmount value={cell.margin.transport} locale={locale} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <SignedAmount value={cell.margin.handling} locale={locale} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <SignedAmount value={cell.margin.total} locale={locale} bold />
                            {!cell.complete ? (
                              <span className="ml-1 text-[11px] text-[var(--muted)]">{t("flags.partial")}</span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <SignedAmount value={cell.margin.perUnit} locale={locale} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Pct value={cell.margin.pct} locale={locale} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <SignedAmount value={cell.fx.gainEur} locale={locale} />
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <p className="mt-6 text-xs text-[var(--faint)]">
        {t("settingsNote", {
          handling: eur(settings.handling_cost_eur),
          fx: settings.fx_rmb_per_eur,
          fxMarket: settings.fx_market_rate,
        })}
      </p>
    </div>
  );
}
