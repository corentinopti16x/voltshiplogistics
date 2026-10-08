import { redirect } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { Link } from "@/i18n/routing";
import { ProductPhoto } from "@/components/client/product-photo";
import { SourcerShell } from "@/components/sourcer/sourcer-shell";
import type { ProductRow } from "@/lib/products/types";

export default async function SourcerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: "en" | "fr" }>;
  searchParams: Promise<{ q?: string; status?: string; backfill?: string }>;
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
  const rows = ([...(data ?? []), ...restockedInStock] as QueueRow[]).filter((row) => {
    if (query && !`${row.title} ${row.sku ?? ""} ${row.clients?.name ?? ""}`.toLowerCase().includes(query)) {
      return false;
    }
    if (status && row.sourcing_status !== status) return false;
    if (filters.backfill === "true" && row.migration_state !== "imported_pending") return false;
    return true;
  });

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
        <button className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-white">
          {t("apply")}
        </button>
      </form>

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
                <th className="px-4 py-3">{t("columns.product")}</th>
                <th className="px-4 py-3">{t("columns.client")}</th>
                <th className="px-4 py-3">{t("columns.status")}</th>
                <th className="px-4 py-3">{t("columns.missing")}</th>
                <th className="px-4 py-3">{t("columns.created")}</th>
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
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {new Date(row.created_at).toLocaleDateString()}
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
