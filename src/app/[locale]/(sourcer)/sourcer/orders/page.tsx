import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui";
import { SourcerShell } from "@/components/sourcer/sourcer-shell";
import { Link, redirect } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { formatDate, formatNumber } from "@/lib/format";
import { loadAchats } from "@/lib/orders/to-ship-server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function daysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const isSkuless = (sku: string) => /^shopify-/i.test(sku.trim());
/** Demo / test tenants never shown to the team. */
const isFakeClient = (name: string) => /d[ée]mo|^test$|altair|voltship logistics/i.test(name.trim());
/** Shopify lines that are not physical goods (insurance, free shipping…). */
const notGoods = (title: string | null | undefined) =>
  /assurance|insurance|livraison gratuite|free shipping|shipping protection|composants coffret|pourboire|tip\b/i.test(title ?? "");

/** Warehouse / supply-chain view of every open Shopify order: products, variants, SKU gaps, stock alerts. */
export default async function TeamOrdersPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const [query, loc, t] = await Promise.all([searchParams, getLocale(), getTranslations("sourcer.orders")]);
  const ctx = await getAuthContext();
  if (!ctx) {
    redirect({ href: "/staff/login", locale: loc });
    return null;
  }
  if (ctx.role !== "sourcer" && ctx.role !== "voltship_admin") {
    redirect({ href: "/home", locale: loc });
    return null;
  }
  const locale = loc === "fr" ? "fr" : "en";
  const clientId = query.client?.trim() || null;
  const data = await loadAchats({ since: daysAgo(60), clientId, coverDays: 14 });
  const num = (value: number | null | undefined, digits = 0) =>
    value == null ? "—" : formatNumber(value, locale, digits);

  const pending = data.pending.filter((order) => !isFakeClient(order.clientName));
  const clients = data.clients.filter((client) => !isFakeClient(client.name));
  const lines = data.buy
    .filter((line) => !isFakeClient(line.clientName) && !notGoods(line.title) && line.backlog > 0)
    .sort((a, b) => b.backlog - a.backlog);
  // Only real alerts: known stock that runs out before restock. Unknown stock is not an alert.
  const alerts = lines.filter((line) => line.stock != null && line.urgent);
  const fresh = lines.filter((line) => !line.productId);
  const skulessOrders = pending.filter(
    (order) => order.unitsWithoutSku > 0 || order.lines.some((line) => isSkuless(line.sku) && !notGoods(line.title)),
  );
  const td = "px-3 py-2 align-top";
  const th = "px-3 py-2 text-left text-[11px] font-medium text-[var(--muted)]";

  return (
    <SourcerShell role={ctx.role}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("intro")}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link href="/sourcer/orders" className={`rounded-lg px-3 py-1.5 ring-1 ring-[var(--line)] ${clientId ? "" : "bg-[var(--line)]"}`}>
              {t("allClients")}
            </Link>
            {clients.map((client) => (
              <Link
                key={client.id}
                href={`/sourcer/orders?client=${client.id}`}
                className={`rounded-lg px-3 py-1.5 ring-1 ring-[var(--line)] ${clientId === client.id ? "bg-[var(--line)]" : ""}`}
              >
                {client.name}
              </Link>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [t("kpi.orders"), pending.length],
            [t("kpi.pieces"), lines.reduce((sum, line) => sum + line.backlog, 0)],
            [t("kpi.new"), fresh.length],
            [t("kpi.noSku"), skulessOrders.length],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
              <p className="text-xs text-[var(--muted)]">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{num(Number(value))}</p>
            </div>
          ))}
        </div>

        {alerts.length > 0 ? (
          <section className="rounded-xl bg-[var(--card)] ring-1 ring-[var(--line)]">
            <h2 className="border-b border-[var(--line)] px-5 py-3 text-sm font-semibold">{t("alerts.title")}</h2>
            <p className="px-5 pt-2 text-xs text-[var(--muted)]">{t("alerts.help")}</p>
            <ul className="divide-y divide-[var(--line)] text-sm">
              {alerts.map((line) => (
                <li key={`${line.clientId}|${line.sku}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2">
                  <Badge tone="rust">{t("alerts.runway", { days: line.runwayDays ?? 0 })}</Badge>
                  <span className="font-medium">{line.title ?? line.sku}</span>
                  <span className="text-xs text-[var(--muted)]">{line.clientName} · {line.sku}</span>
                  <span className="ml-auto text-xs tabular-nums">
                    {t("alerts.detail", { stock: num(line.stock), perDay: num(line.perDay, 1), toBuy: num(line.toBuy) })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {skulessOrders.length > 0 ? (
          <section className="rounded-xl bg-[var(--card)] ring-1 ring-[var(--line)]">
            <h2 className="border-b border-[var(--line)] px-5 py-3 text-sm font-semibold">{t("noSku.title")}</h2>
            <p className="px-5 pt-3 text-xs text-[var(--muted)]">{t("noSku.intro")}</p>
            <ul className="divide-y divide-[var(--line)] text-sm">
              {skulessOrders.slice(0, 80).map((order) => (
                <li key={`${order.shopId}:${order.orderId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2">
                  <span className="w-16 font-medium">{order.name ?? order.orderId}</span>
                  <span className="text-xs text-[var(--muted)]">{order.clientName} · {formatDate(order.date, locale)}</span>
                  <span className="text-xs">
                    {order.lines
                      .map((line) => `${line.quantity} × ${line.title ?? line.sku}${line.variant ? ` (${line.variant})` : ""}`)
                      .join(" · ")}
                  </span>
                  {order.unitsWithoutSku > 0 ? <Badge tone="rust">{t("noSku.missing", { count: order.unitsWithoutSku })}</Badge> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {fresh.length > 0 ? (
          <section className="rounded-xl bg-[var(--card)] ring-1 ring-[var(--line)]">
            <h2 className="border-b border-[var(--line)] px-5 py-3 text-sm font-semibold">{t("fresh.title")}</h2>
            <p className="px-5 pt-2 text-xs text-[var(--muted)]">{t("fresh.help")}</p>
            <ul className="divide-y divide-[var(--line)] text-sm">
              {fresh.map((line) => (
                <li key={`${line.clientId}|${line.sku}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2">
                  <Badge tone="gold">{t("fresh.badge")}</Badge>
                  <span className="font-medium">{line.title ?? line.sku}</span>
                  {line.variants.length ? <span className="text-xs">{line.variants.join(" · ")}</span> : null}
                  <span className="text-xs text-[var(--muted)]">{line.clientName} · {line.sku}</span>
                  <span className="ml-auto text-xs font-semibold tabular-nums">{t("fresh.toShip", { count: line.backlog })}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="overflow-x-auto rounded-xl bg-[var(--card)] ring-1 ring-[var(--line)]">
          <h2 className="border-b border-[var(--line)] px-5 py-3 text-sm font-semibold">{t("products.title")}</h2>
          <p className="px-5 pt-2 text-xs text-[var(--muted)]">{t("products.help")}</p>
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--line)]">
              <tr>
                <th className={th}>{t("products.product")}</th>
                <th className={th}>{t("products.variants")}</th>
                <th className={th}>{t("products.client")}</th>
                <th className={`${th} text-right`}>{t("products.toShip")}</th>
                <th className={`${th} text-right`}>{t("products.stock")}</th>
                <th className={`${th} text-right`}>{t("products.incoming")}</th>
                <th className={`${th} text-right`}>{t("products.toBuy")}</th>
                <th className={th}>{t("products.supplier")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={`${line.clientId}|${line.sku}`} className="border-b border-[var(--line)] last:border-0">
                  <td className={td}>
                    <div className="flex items-start gap-3">
                      {line.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={line.photoUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-[var(--line)]" />
                      ) : (
                        <div className="h-12 w-12 shrink-0 rounded-lg bg-[var(--line)]" />
                      )}
                      <div>
                        {line.productId ? (
                          <Link href={`/sourcer/${line.productId}`} className="font-medium hover:underline">
                            {line.title ?? line.sku}
                          </Link>
                        ) : (
                          <span className="font-medium">{line.title ?? line.sku}</span>
                        )}
                        <p className="mt-0.5 text-[11px] text-[var(--muted)]">{line.sku}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {line.urgent ? <Badge tone="rust">{t("products.urgent")}</Badge> : null}
                          {isSkuless(line.sku) ? <Badge tone="rust">{t("products.noSku")}</Badge> : null}
                          {!line.productId ? <Badge tone="grey">{t("products.noSheet")}</Badge> : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className={`${td} text-xs`}>{line.variants.length ? line.variants.join(" · ") : "—"}</td>
                  <td className={td}>{line.clientName}</td>
                  <td className={`${td} text-right tabular-nums`}>
                    {num(line.backlog)}
                    <span className="block text-[11px] text-[var(--muted)]">{t("products.orders", { count: line.orders })}</span>
                  </td>
                  <td className={`${td} text-right tabular-nums`}>
                    {num(line.stock)}
                    <span className="block text-[11px] text-[var(--muted)]">{t("products.sales", { perDay: num(line.perDay, 1) })}</span>
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{line.incoming > 0 ? num(line.incoming) : "—"}</td>
                  <td className={`${td} text-right font-semibold tabular-nums`}>{line.toBuy > 0 ? num(line.toBuy) : "—"}</td>
                  <td className={`${td} text-xs`}>
                    {line.supplier ?? "—"}
                    {line.factoryPriceRmb != null ? <span className="block text-[var(--muted)]">¥{num(line.factoryPriceRmb, 2)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>


        <details className="rounded-xl bg-[var(--card)] ring-1 ring-[var(--line)]">
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">{t("list.title")}</summary>
          <p className="px-5 pt-2 text-xs text-[var(--muted)]">{t("list.help")}</p>
          <ul className="divide-y divide-[var(--line)] text-sm">
            {pending.slice(0, 200).map((order) => (
              <li key={`${order.shopId}:${order.orderId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2">
                <span className="w-16 font-medium">{order.name ?? order.orderId}</span>
                <span className="text-xs text-[var(--muted)]">{order.clientName} · {order.shopDomain}</span>
                <span className="text-xs">{formatDate(order.date, locale)}</span>
                <Badge tone={order.ageDays > 7 ? "rust" : "grey"}>{t("list.age", { days: order.ageDays })}</Badge>
                {order.eccang !== "none" ? <Badge tone="green">ECCANG</Badge> : null}
                <span className="basis-full text-xs text-[var(--muted)]">
                  {order.lines
                    .map((line) => `${line.quantity} × ${line.title ?? line.sku}${line.variant ? ` (${line.variant})` : ""} [${line.sku}]`)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </SourcerShell>
  );
}
