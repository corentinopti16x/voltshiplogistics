import { redirect } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { Link } from "@/i18n/routing";
import { ProductPhoto } from "@/components/client/product-photo";
import { SourcerShell } from "@/components/sourcer/sourcer-shell";
import type { ProductRow } from "@/lib/products/types";
import { isShopifyImport, unitsSold90d, type SalesVariant } from "@/lib/products/sales90";

type SortKey = "created" | "sales" | "title" | "client" | "status";
const SORT_KEYS: SortKey[] = ["created", "sales", "title", "client", "status"];

export default async function SourcerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: "en" | "fr" }>;
  searchParams: Promise<{ q?: string; status?: string; backfill?: string; sort?: string; dir?: string; zero?: string }>;
}) {
  const { locale } = await params;
  const ctx = await getAuthContext();
  const t = await getTranslations("sourcer.queue");
  const filters = await searchParams;

  if (!ctx) {
    redirect({ href: "/staff/login", locale });
    return null;
  }

  if (ctx.role !== "sourcer" && ctx.role !== "voltship_admin") {
    redirect({ href: "/home", locale });
    return null;
  }

  const admin = createAdminClient();
  const [{ data }, { data: stocked }] = await Promise.all([
    admin
      .from("products_cache")
      .select("*, clients!inner(name, code)")
      .neq("sourcing_status", "in_stock")
      .order("created_at", { ascending: true }),
    admin
      .from("products_cache")
      .select("*, clients!inner(name, code)")
      .eq("sourcing_status", "in_stock")
      .order("created_at", { ascending: true }),
  ]);
  const restockedInStock = (stocked ?? []).filter((row) => {
    const quote = row.quote_json;
    return (
      quote &&
      typeof quote === "object" &&
      Array.isArray((quote as { _restocks?: unknown })._restocks) &&
      (quote as { _restocks: unknown[] })._restocks.length > 0
    );
  });
  type QueueRow = ProductRow & { clients: { name: string; code: string | null } | null };
  const query = (filters.q ?? "").trim().toLowerCase();
  const status = filters.status ?? "";
  const allRows = [...(data ?? []), ...restockedInStock] as QueueRow[];
  // Units sold over 90 days (Shopify cache), per product of the queue.
  const clientIds = [...new Set(allRows.map((row) => row.client_id))];
  const variants: SalesVariant[] = [];
  if (clientIds.length > 0) {
    for (let from = 0; from < 50000; from += 1000) {
      const { data: page } = await admin
        .from("shopify_products_cache")
        .select("id, client_id, sku, units_90d, imported_product_id")
        .in("client_id", clientIds)
        .order("id")
        .range(from, from + 999);
      variants.push(...((page ?? []) as SalesVariant[]));
      if (!page || page.length < 1000) break;
    }
  }
  const sales = unitsSold90d(allRows, variants);
  // Shopify pages imported automatically with no sale in 90 days are hidden by default
  // (briefs sent by the client always stay).
  const showZero = filters.zero === "1";
  const hiddenZero = allRows.filter(
    (row) => isShopifyImport(row.migration_state) && (sales.get(row.id) ?? 0) === 0,
  ).length;
  const sort: SortKey = SORT_KEYS.includes(filters.sort as SortKey) ? (filters.sort as SortKey) : "created";
  const dir = filters.dir === "desc" || filters.dir === "asc" ? filters.dir : sort === "sales" ? "desc" : "asc";
  const rows = allRows.filter((row) => {
    if (!showZero && isShopifyImport(row.migration_state) && (sales.get(row.id) ?? 0) === 0) return false;
    if (query && !`${row.title} ${row.sku ?? ""} ${row.clients?.name ?? ""}`.toLowerCase().includes(query)) {
      return false;
    }
    if (status && row.sourcing_status !== status) return false;
    if (filters.backfill === "true" && row.migration_state !== "imported_pending") return false;
    return true;
  });
  const compare = (a: QueueRow, b: QueueRow) => {
    switch (sort) {
      case "sales":
        return (sales.get(a.id) ?? 0) - (sales.get(b.id) ?? 0);
      case "title":
        return a.title.localeCompare(b.title);
      case "client":
        return (a.clients?.name ?? "").localeCompare(b.clients?.name ?? "");
      case "status":
        return (a.sourcing_status ?? "").localeCompare(b.sourcing_status ?? "");
      default:
        return String(a.created_at).localeCompare(String(b.created_at));
    }
  };
  rows.sort(
    (a, b) => (dir === "desc" ? -compare(a, b) : compare(a, b)) || String(a.created_at).localeCompare(String(b.created_at)),
  );
  const href = (next: { sort?: SortKey; dir?: string; zero?: boolean }) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (status) params.set("status", status);
    if (filters.backfill === "true") params.set("backfill", "true");
    const nextSort = next.sort ?? sort;
    if (nextSort !== "created") params.set("sort", nextSort);
    const nextDir = next.dir ?? dir;
    if (nextDir) params.set("dir", nextDir);
    if (next.zero ?? showZero) params.set("zero", "1");
    return `/sourcer?${params.toString()}`;
  };
  const sortHeader = (col: SortKey, label: string, align?: "right") => {
    const active = sort === col;
    const nextDir = active ? (dir === "asc" ? "desc" : "asc") : col === "sales" || col === "created" ? "desc" : "asc";
    return (
      <th key={col} className={`px-4 py-3 ${align === "right" ? "text-right" : ""}`}>
        <Link
          href={href({ sort: col, dir: nextDir })}
          className={`inline-flex items-center gap-1 hover:text-[var(--ink)] ${active ? "text-[var(--ink)]" : ""}`}
        >
          {label}
          <span aria-hidden>{active ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>
        </Link>
      </th>
    );
  };
  return (
    <SourcerShell role={ctx.role}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">
            {t("eyebrow")}
          </p>
          <h1 className="font-display mt-2 text-3xl">{t("title")}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {t("intro")}
          </p>
        </div>
        <span className="rounded-full bg-[var(--card)] px-3 py-1 text-sm ring-1 ring-[var(--line)]">
          {t("openCount", { count: rows.length })}
        </span>
      </div>

      <form method="get" className="mt-6 grid gap-3 sm:grid-cols-4">
        <input
          name="q"
          defaultValue={filters.q}
          placeholder={t("searchPlaceholder")}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
        />
        <select
          name="status"
          defaultValue={status}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
        >
          <option value="">{t("allStatuses")}</option>
          {["brief_received", "factories", "samples", "negotiation", "quote_sent", "flagged"].map(
            (item) => (
              <option key={item} value={item}>
                {t(`statuses.${item}`)}
              </option>
            ),
          )}
        </select>
        <label className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm">
          <input
            type="checkbox"
            name="backfill"
            value="true"
            defaultChecked={filters.backfill === "true"}
          />
          {t("backfillOnly")}
        </label>
        {sort !== "created" ? <input type="hidden" name="sort" value={sort} /> : null}
        <input type="hidden" name="dir" value={dir} />
        {showZero ? <input type="hidden" name="zero" value="1" /> : null}
        <button className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-white">
          {t("apply")}
        </button>
      </form>

      {hiddenZero > 0 || showZero ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          {showZero ? t("zeroShown") : t("zeroHidden", { count: hiddenZero })}{" "}
          <Link href={href({ zero: !showZero })} className="font-medium text-[var(--ink)] underline">
            {showZero ? t("hideZero") : t("showZero")}
          </Link>
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-8 text-sm text-[var(--muted)]">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--line)] text-xs text-[var(--muted)] uppercase">
              <tr>
                <th className="px-4 py-3">{t("columns.photo")}</th>
                {sortHeader("title", t("columns.product"))}
                {sortHeader("client", t("columns.client"))}
                {sortHeader("status", t("columns.status"))}
                <th className="px-4 py-3">{t("columns.missing")}</th>
                {sortHeader("sales", t("columns.sales90"), "right")}
                {sortHeader("created", t("columns.created"))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const missing = [
                  row.client_price == null ? "price" : null,
                  row.weight_g == null ? "weight" : null,
                  !row.shipping_channel ? "channel" : null,
                ].filter(Boolean);
                return (
                  <tr key={row.id} className="border-b border-[var(--line)]">
                    <td className="px-4 py-3">
                      <ProductPhoto
                        src={row.photo_url}
                        alt={row.title}
                        className="h-12 w-12 rounded-md"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/sourcer/${row.id}`} className="font-medium hover:underline">
                        {row.title}
                      </Link>
                      <p className="text-xs text-[var(--muted)]">{row.sku ?? t("noSku")}</p>
                    </td>
                    <td className="px-4 py-3">{row.clients?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      {t(`statuses.${row.sourcing_status ?? "brief_received"}`)}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {missing.length
                        ? missing.map((item) => t(`missing.${item}`)).join(t("listSeparator"))
                        : t("ready")}
                    </td>
                    <td className="tabular px-4 py-3 text-right font-medium">
                      {(sales.get(row.id) ?? 0).toLocaleString(locale)}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {new Date(row.created_at).toLocaleDateString(locale)}
                    </td>
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
