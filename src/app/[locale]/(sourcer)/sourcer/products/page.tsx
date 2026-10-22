import { redirect, Link } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { ProductPhoto } from "@/components/client/product-photo";
import { SourcerShell } from "@/components/sourcer/sourcer-shell";
import type { ProductRow } from "@/lib/products/types";
import { unitsSold90d, type SalesVariant } from "@/lib/products/sales90";
import { calculateCatalogQuotes } from "@/lib/pricing/catalog";
import { carrierLineLabel } from "@/lib/domain/carrier-rules";
import { hasInternalBattery } from "@/lib/domain/pricing";
import { clientNote, packPieces, productBox } from "@/lib/products/extras";
import { formatAmount } from "@/lib/format";
import { parseUpsellIds } from "@/lib/products/upsells";
import { stockBySku, upsellOwners } from "@/lib/products/upsells-server";
import { refreshUpsellsAction } from "@/app/actions/upsells";
import { readPricingSettings } from "@/lib/pricing/settings";
import { QuickEditRow } from "@/components/sourcer/quick-edit-row";
import { loadSevenDayTrends } from "@/lib/products/sales7-server";
import { SalesTrendBadge } from "@/components/sourcer/sales-trend-badge";

export const dynamic = "force-dynamic";

type SortKey = "sales" | "title" | "client" | "created";
const SORT_KEYS: SortKey[] = ["sales", "title", "client", "created"];
type CatalogRow = ProductRow & { clients: { name: string; code: string | null } | null };

/**
 * « Produits » — every product of every client and shop in one list: search, COGS for one
 * unit per market with the carrier line that ships it, set size, sales. Read-only; the
 * product link opens the sourcing sheet where everything is edited.
 */
export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: "en" | "fr" }>;
  searchParams: Promise<{ q?: string; client?: string; data?: string; sort?: string; archived?: string; edit?: string }>;
}) {
  const { locale } = await params;
  const ctx = await getAuthContext();
  if (!ctx) {
    redirect({ href: "/staff/login", locale });
    return null;
  }
  if (ctx.role !== "sourcer" && ctx.role !== "voltship_admin") {
    redirect({ href: "/home", locale });
    return null;
  }
  const t = await getTranslations("sourcer.catalog");
  const tQueue = await getTranslations("sourcer.queue");
  const filters = await searchParams;
  const isAdmin = ctx.role === "voltship_admin";
  const admin = createAdminClient();

  const products: CatalogRow[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    let query = admin.from("products_cache").select("*, clients!inner(name, code)");
    if (filters.archived !== "1") query = query.neq("lifecycle_status", "archived");
    const { data: page } = await query.order("id").range(from, from + 999);
    products.push(...((page ?? []) as CatalogRow[]));
    if (!page || page.length < 1000) break;
  }

  const clientIds = [...new Set(products.map((row) => row.client_id))];
  const variants: Array<SalesVariant & { shop_id: string | null }> = [];
  if (clientIds.length > 0) {
    for (let from = 0; from < 50_000; from += 1000) {
      const { data: page } = await admin
        .from("shopify_products_cache")
        .select("id, client_id, shop_id, sku, units_90d, imported_product_id")
        .in("client_id", clientIds)
        .order("id")
        .range(from, from + 999);
      variants.push(...((page ?? []) as typeof variants));
      if (!page || page.length < 1000) break;
    }
  }
  const [{ data: shops }, { data: apps }] = await Promise.all([
    admin.from("shops").select("id, shopify_domain"),
    admin.from("shopify_app_credentials").select("shopify_domain, label"),
  ]);
  const labelByDomain = new Map(
    (apps ?? []).map((app) => [app.shopify_domain as string, (app.label as string | null) ?? ""]),
  );
  const shopLabel = new Map(
    (shops ?? []).map((shop) => [
      shop.id as string,
      labelByDomain.get(shop.shopify_domain as string) ||
        String(shop.shopify_domain ?? "").replace(".myshopify.com", ""),
    ]),
  );
  const sales = unitsSold90d(products, variants);
  // This week vs last week, shown next to the 90-day total (what to fill in first).
  const trends = await loadSevenDayTrends(products, variants).catch(() => new Map());
  // Shops selling each product (variant imported into it, or same SKU on the client's shops).
  const skuOwner = new Map<string, string>();
  for (const product of products) {
    const sku = (product.sku ?? "").trim().toLowerCase();
    if (sku) skuOwner.set(`${product.client_id}|${sku}`, product.id);
  }
  const shopsOf = new Map<string, Set<string>>();
  for (const variant of variants) {
    const productId =
      variant.imported_product_id ??
      skuOwner.get(`${variant.client_id}|${(variant.sku ?? "").trim().toLowerCase()}`) ??
      null;
    if (!productId || !variant.shop_id) continue;
    const label = shopLabel.get(variant.shop_id);
    if (!label) continue;
    const set = shopsOf.get(productId) ?? new Set<string>();
    set.add(label);
    shopsOf.set(productId, set);
  }

  const clients = [...new Map(products.map((row) => [row.client_id, row.clients?.name ?? "?"])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1]),
  );
  const q = (filters.q ?? "").trim().toLowerCase();
  const dataFilter =
    filters.data === "ready" || filters.data === "missing" || filters.data === "upsells" ? filters.data : "";
  // Upsells: products sold with another one (pouch, case…), to keep in stock with it.
  const owners = upsellOwners(products);
  const upsellRows = products.filter((row) => owners.has(row.id));
  const upsellStock = new Map<string, number | null>();
  for (const clientId of new Set(upsellRows.map((row) => row.client_id))) {
    const ofClient = upsellRows.filter((row) => row.client_id === clientId);
    const stock = await stockBySku(
      clientId,
      ofClient.map((row) => row.sku).filter((sku): sku is string => !!sku),
    ).catch(() => new Map<string, number>());
    for (const row of ofClient) {
      upsellStock.set(row.id, row.sku && stock.has(row.sku) ? (stock.get(row.sku) as number) : row.stock_manual ?? null);
    }
  }
  const isReady = (row: CatalogRow) => row.client_price != null && row.weight_g != null && !!row.shipping_channel;
  const rows = products.filter((row) => {
    if (filters.client && row.client_id !== filters.client) return false;
    if (dataFilter === "ready" && !isReady(row)) return false;
    if (dataFilter === "missing" && isReady(row)) return false;
    if (dataFilter === "upsells" && !owners.has(row.id) && parseUpsellIds(row.quote_json).length === 0) return false;
    if (q) {
      const haystack = `${row.title} ${row.sku ?? ""} ${row.clients?.name ?? ""} ${[...(shopsOf.get(row.id) ?? [])].join(" ")}`;
      if (!haystack.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const sort: SortKey = SORT_KEYS.includes(filters.sort as SortKey) ? (filters.sort as SortKey) : "sales";
  rows.sort((a, b) => {
    switch (sort) {
      case "title":
        return a.title.localeCompare(b.title);
      case "client":
        return (a.clients?.name ?? "").localeCompare(b.clients?.name ?? "") || a.title.localeCompare(b.title);
      case "created":
        return String(b.created_at).localeCompare(String(a.created_at));
      default:
        return (sales.get(b.id) ?? 0) - (sales.get(a.id) ?? 0) || a.title.localeCompare(b.title);
    }
  });
  const quotes = await calculateCatalogQuotes(rows);
  // « Saisie rapide »: factory prices (¥) of the listed products, edited inline.
  const editMode = filters.edit === "1";
  const settings = await readPricingSettings(admin);
  const factoryById = new Map<string, number | null>();
  const rowIds = rows.map((row) => row.id);
  for (let from = 0; from < rowIds.length; from += 300) {
    const { data: work } = await admin
      .from("sourcing_work")
      .select("product_id, factory_purchase_price")
      .in("product_id", rowIds.slice(from, from + 300));
    for (const item of work ?? []) {
      factoryById.set(item.product_id as string, (item.factory_purchase_price as number | null) ?? null);
    }
  }
  const editHref = (on: boolean) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (key !== "edit" && typeof value === "string" && value) query.set(key, value);
    }
    if (on) query.set("edit", "1");
    const text = query.toString();
    return `/sourcer/products${text ? `?${text}` : ""}`;
  };
  const readyCount = rows.filter(isReady).length;

  return (
    <SourcerShell role={ctx.role}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">{t("eyebrow")}</p>
          <h1 className="font-display mt-2 text-3xl">{t("title")}</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">{t("intro")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[var(--card)] px-3 py-1 text-sm ring-1 ring-[var(--line)]">
            {t("count", { count: rows.length, ready: readyCount })}
          </span>
          <Link
            href={editHref(!editMode)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              editMode ? "bg-[var(--navy)] text-white" : "bg-[var(--accent)] text-white"
            }`}
          >
            {editMode ? t("quickOff") : t("quickOn")}
          </Link>
        </div>
      </div>

      <form method="get" className="mt-6 grid gap-3 sm:grid-cols-5">
        {editMode ? <input type="hidden" name="edit" value="1" /> : null}
        <input
          name="q"
          defaultValue={filters.q}
          placeholder={t("searchPlaceholder")}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm sm:col-span-2"
        />
        <select
          name="client"
          defaultValue={filters.client ?? ""}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
        >
          <option value="">{t("allClients")}</option>
          {clients.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          name="data"
          defaultValue={dataFilter}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
        >
          <option value="">{t("dataAll")}</option>
          <option value="ready">{t("dataReady")}</option>
          <option value="missing">{t("dataMissing")}</option>
          <option value="upsells">{t("dataUpsells")}</option>
        </select>
        <div className="flex gap-2">
          <select
            name="sort"
            defaultValue={sort}
            aria-label={t("sortLabel")}
            className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
          >
            {SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {t(`sort.${key}`)}
              </option>
            ))}
          </select>
          <button className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-white">
            {t("apply")}
          </button>
        </div>
      </form>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted)]">{t("carrierLegend")}</p>
        <form action={refreshUpsellsAction}>
          <input type="hidden" name="client_id" value={filters.client ?? ""} />
          <button className="cursor-pointer rounded-md border border-[var(--line)] px-2.5 py-1 text-xs">{t("detectUpsells")}</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-8 text-sm text-[var(--muted)]">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <table className={`w-full text-left text-sm ${editMode ? "min-w-[1480px]" : "min-w-[980px]"}`}>
            <thead className="border-b border-[var(--line)] text-xs text-[var(--muted)] uppercase">
              <tr>
                <th className="px-4 py-3">{t("columns.photo")}</th>
                <th className="px-4 py-3">{t("columns.product")}</th>
                <th className="px-4 py-3">{t("columns.client")}</th>
                <th className="px-4 py-3 text-right">{t("columns.price")}</th>
                <th className="px-4 py-3">{t("columns.cogs")}</th>
                <th className="px-4 py-3 text-right">{t("columns.sales")}</th>
                {editMode ? <th className="px-4 py-3">{t("columns.quick")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const quote = quotes.get(row.id);
                const pieces = packPieces(row.quote_json);
                const shopNames = [...(shopsOf.get(row.id) ?? [])].sort();
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-[var(--line)] align-top ${
                      isReady(row) ? "" : "bg-red-50/60 shadow-[inset_3px_0_0_#dc2626]"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <ProductPhoto src={row.photo_url} alt={row.title} className="h-12 w-12 rounded-md" />
                    </td>
                    <td className="max-w-[280px] px-4 py-3">
                      <Link href={`/sourcer/${row.id}`} className="font-medium hover:underline">
                        {row.title}
                      </Link>
                      <p className="text-xs text-[var(--muted)]">
                        {row.sku ?? tQueue("noSku")} · {tQueue(`statuses.${row.sourcing_status ?? "brief_received"}`)}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {pieces > 1 ? (
                          <span className="rounded bg-[#f3e6bf] px-1.5 py-0.5 text-[11px] font-semibold">
                            {t("set", { count: pieces })}
                          </span>
                        ) : null}
                        {productBox(row.quote_json) ? (
                          <span className="rounded bg-[var(--card-soft)] px-1.5 py-0.5 text-[11px] ring-1 ring-[var(--line)]">
                            {t("box", {
                              price: String(productBox(row.quote_json)?.priceRmb ?? 0),
                              weight: String(productBox(row.quote_json)?.weightG ?? 0),
                            })}
                          </span>
                        ) : null}
                        {(() => {
                          const box = productBox(row.quote_json);
                          const factory = factoryById.get(row.id);
                          return box && factory != null && factory > 0 && box.priceRmb === Number(factory) ? (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-900">
                              {t("boxEqualsFactory")}
                            </span>
                          ) : null;
                        })()}
                        {hasInternalBattery(row.quote_json) ? (
                          <span className="rounded bg-[var(--card-soft)] px-1.5 py-0.5 text-[11px] ring-1 ring-[var(--line)]">
                            {t("battery")}
                          </span>
                        ) : null}
                        {parseUpsellIds(row.quote_json).length > 0 ? (
                          <Link
                            href={`/sourcer/${row.id}#upsells`}
                            className="rounded bg-[#e3ecd9] px-1.5 py-0.5 text-[11px] font-semibold text-[#2f4a1f]"
                          >
                            {t("hasUpsells", { count: parseUpsellIds(row.quote_json).length })}
                          </Link>
                        ) : null}
                        {owners.has(row.id) ? (
                          <span className="rounded bg-[#e3ecd9] px-1.5 py-0.5 text-[11px] text-[#2f4a1f]">
                            {t("upsellOf", { products: (owners.get(row.id) ?? []).join(", ") })}
                          </span>
                        ) : null}
                        {owners.has(row.id) ? (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                              upsellStock.get(row.id) == null
                                ? "bg-[var(--card-soft)] text-[var(--muted)] ring-1 ring-[var(--line)]"
                                : (upsellStock.get(row.id) as number) > 0
                                  ? "bg-emerald-100 text-emerald-900"
                                  : "bg-red-100 text-red-900"
                            }`}
                          >
                            {upsellStock.get(row.id) == null
                              ? t("upsellStockUnknown")
                              : t("upsellStock", { count: upsellStock.get(row.id) as number })}
                          </span>
                        ) : null}
                        {clientNote(row.quote_json) ? (
                          <span className="rounded bg-[var(--blue-soft)] px-1.5 py-0.5 text-[11px] text-[var(--blue-ink)]">
                            {t("hasNote")}
                          </span>
                        ) : null}
                        {isAdmin ? (
                          <Link
                            href={`/admin/margin/products/${row.id}`}
                            className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[11px] text-[var(--muted)] hover:text-[var(--ink)]"
                          >
                            {tQueue("marginLink")}
                          </Link>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {row.clients?.name ?? "—"}
                      {shopNames.length > 0 ? (
                        <p className="text-xs text-[var(--muted)]">{shopNames.join(", ")}</p>
                      ) : null}
                    </td>
                    <td className="tabular px-4 py-3 text-right whitespace-nowrap">
                      {row.client_price != null ? formatAmount(Number(row.client_price), locale) : "—"}
                      <p className="text-xs text-[var(--muted)]">
                        {row.weight_g == null
                          ? t("noWeight")
                          : quote?.packagingG
                            ? t("weightWithPackaging", { weight: row.weight_g, packaging: quote.packagingG })
                            : `${row.weight_g} g`}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {!quote || quote.missing ? (
                        <span className="text-xs text-[var(--muted)]">
                          {quote?.missing === "grid" ? t("missingGrid") : t("missingData")}
                        </span>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {quote.markets.map((market) => (
                            <li key={market.destination} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                              <span className="w-7 font-bold">{market.destination}</span>
                              <span className="tabular w-[72px] text-right font-semibold">
                                {market.cogs != null ? formatAmount(market.cogs, locale) : "—"}
                              </span>
                              <span className={market.line ? "text-[var(--blue-ink)]" : "text-[var(--rust-ink)]"}>
                                {market.line ? carrierLineLabel(market.line) : t("noRate")}
                              </span>
                              {market.line ? (
                                <span className="text-[11px] text-[var(--muted)]">
                                  {t(`mode.${market.fallback ? "fallback" : market.mode}`)}
                                  {market.announced ? ` · ${t("announced")}` : ""}
                                </span>
                              ) : null}
                              {market.covered ? (
                                <span className="basis-full pl-9 text-[12px] text-[var(--green-ink)]">
                                  {t("covered", {
                                    value: formatAmount(market.covered.cogs, locale),
                                    line: carrierLineLabel(market.covered.line),
                                  })}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <SalesTrendBadge trend={trends.get(row.id)} locale={locale} />
                        <span className="tabular text-xs text-[var(--muted)]">
                          {t("sales90Short", { count: (sales.get(row.id) ?? 0).toLocaleString(locale) })}
                        </span>
                      </div>
                    </td>
                    {editMode ? (
                      <td className="px-4 py-3">
                        <QuickEditRow
                          productId={row.id}
                          factoryRmb={factoryById.get(row.id) ?? null}
                          clientPrice={row.client_price != null ? Number(row.client_price) : null}
                          weightG={row.weight_g}
                          channel={row.shipping_channel}
                          status={row.sourcing_status}
                          fxRmbPerEur={settings.fx_rmb_per_eur}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SourcerShell>
  );
}
