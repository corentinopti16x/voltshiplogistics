import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAllPurchaseOrders, listPendingRestockRequests } from "@/lib/purchase-orders/queries";
import { PURCHASE_ORDER_STATUSES, PURCHASE_ORDER_STEPS } from "@/lib/purchase-orders/core";
import { updatePurchaseOrderAction } from "@/app/actions/purchase-orders";
import { PurchaseOrderForm } from "@/components/admin/purchase-order-form";
import { PurchaseOrderProgress } from "@/components/orders/purchase-order-progress";
import { Badge } from "@/components/ui";
import { formatAmount, formatDate, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminPurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string; client?: string; product?: string; qty?: string; restock_at?: string }>;
}) {
  const [query, rawLocale, t] = await Promise.all([searchParams, getLocale(), getTranslations("admin.orders")]);
  const locale = rawLocale === "fr" ? "fr" : "en";
  const showAll = query.all === "1";
  const admin = createAdminClient();
  const [{ rows, missingTable }, restocks, { data: clients }, { data: products }] = await Promise.all([
    listAllPurchaseOrders({ openOnly: !showAll }),
    listPendingRestockRequests().catch(() => []),
    admin.from("clients").select("id, name").order("name"),
    admin
      .from("products_cache")
      .select("id, client_id, title, client_price, sourcing_status")
      .in("sourcing_status", ["quote_sent", "validated", "in_production", "in_stock"])
      .order("title")
      .limit(3000),
  ]);
  const stepLabels = Object.fromEntries(PURCHASE_ORDER_STEPS.map((step) => [step, t(`step.${step}`)]));
  const field = "rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-[13px]";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">{t("kicker")}</p>
        <h1 className="font-display mt-2 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">{t("lead")}</p>
      </div>

      {missingTable ? (
        <p className="rounded-xl bg-[var(--rust-soft)] px-4 py-3 text-sm text-[var(--rust-ink)]">{t("missingTable")}</p>
      ) : null}

      {restocks.length > 0 ? (
        <section className="rounded-2xl border border-[var(--gold-soft)] bg-[var(--card)] p-5">
          <h2 className="text-sm font-semibold">{t("restocks.title", { count: restocks.length })}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{t("restocks.lead")}</p>
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {restocks.map((request) => (
              <li key={request.key} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="text-xs text-[var(--muted)]">{formatDate(request.at, locale)}</span>
                <span className="font-semibold">{request.clientName}</span>
                <span>{request.productTitle}</span>
                {request.qty ? <Badge tone="blue">{formatNumber(request.qty, locale)} u.</Badge> : null}
                {request.notes ? <span className="text-xs text-[var(--muted)]">« {request.notes} »</span> : null}
                <Link
                  href={`/admin/orders?client=${request.clientId}&product=${request.productId}&qty=${request.qty ?? ""}&restock_at=${encodeURIComponent(request.at)}#new`}
                  className="ml-auto rounded-lg border border-[var(--line)] px-3 py-1.5 text-[13px] font-semibold"
                >
                  {t("restocks.convert")}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section id="new" className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
        <h2 className="mb-1 text-sm font-semibold">{t("form.heading")}</h2>
        <p className="mb-4 text-xs text-[var(--muted)]">{t("form.lead")}</p>
        <PurchaseOrderForm
          key={`${query.client ?? ""}-${query.product ?? ""}-${query.restock_at ?? ""}`}
          clients={(clients ?? []).map((client) => ({ id: client.id, name: client.name }))}
          products={(products ?? []).map((product) => ({
            id: product.id,
            clientId: product.client_id,
            title: product.title,
            clientPrice: product.client_price != null ? Number(product.client_price) : null,
          }))}
          defaults={{
            clientId: query.client,
            productId: query.product,
            qty: query.qty,
            restockAt: query.restock_at,
          }}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{showAll ? t("list.all") : t("list.open")}</h2>
          <Link href={showAll ? "/admin/orders" : "/admin/orders?all=1"} className="text-[13px] text-[var(--blue-ink)] hover:underline">
            {showAll ? t("list.showOpen") : t("list.showAll")}
          </Link>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-6 text-sm text-[var(--muted)]">
            {t("list.empty")}
          </p>
        ) : (
          rows.map((order) => (
            <article key={order.id} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-[var(--muted)]">{order.reference}</span>
                <Badge tone={order.status === "cancelled" ? "grey" : order.status === "received" ? "green" : "gold"}>
                  {t(`status.${order.status}`)}
                </Badge>
                <span className="text-sm font-semibold">{order.client_name}</span>
                <span className="ml-auto text-xs text-[var(--muted)]">{formatDate(order.created_at, locale)}</span>
              </div>
              <p className="mt-1 text-base font-semibold">
                {formatNumber(order.quantity, locale)} × {order.title}
                {order.total_eur != null ? (
                  <span className="ml-2 text-sm font-normal text-[var(--muted)]">· {formatAmount(Number(order.total_eur), locale)}</span>
                ) : null}
              </p>
              <div className="mt-3">
                <PurchaseOrderProgress status={order.status} labels={stepLabels} />
              </div>
              <form action={updatePurchaseOrderAction} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <input type="hidden" name="id" value={order.id} />
                <select name="status" defaultValue={order.status} className={field}>
                  {PURCHASE_ORDER_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {t(`status.${status}`)}
                    </option>
                  ))}
                </select>
                <input name="eta" type="date" defaultValue={order.eta ?? ""} className={field} title={t("form.eta")} />
                <input name="tracking" defaultValue={order.tracking ?? ""} placeholder={t("form.tracking")} className={field} />
                <button className="rounded-lg bg-[var(--navy)] px-3 py-1.5 text-[13px] font-semibold text-white">
                  {t("list.save")}
                </button>
                <textarea
                  name="notes_client"
                  rows={1}
                  defaultValue={order.notes_client ?? ""}
                  placeholder={t("form.notesClient")}
                  className={`${field} sm:col-span-2`}
                />
                <textarea
                  name="notes_internal"
                  rows={1}
                  defaultValue={order.notes_internal ?? ""}
                  placeholder={`🔒 ${t("form.notesInternal")}`}
                  className={`${field} sm:col-span-2`}
                />
              </form>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
