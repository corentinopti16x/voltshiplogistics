import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { Badge } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import { loadAchats } from "@/lib/orders/to-ship-server";
import { AGE_BUCKETS, summarizeShops } from "@/lib/orders/to-ship";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const COVER_CHOICES = [7, 14, 30, 45];
const SINCE_CHOICES = [7, 30, 60];

function daysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export default async function AdminAchatsPage({
  searchParams,
}: {
  searchParams: Promise<{ since?: string; client?: string; cover?: string }>;
}) {
  const [query, rawLocale, t] = await Promise.all([searchParams, getLocale(), getTranslations("admin.achats")]);
  const locale = rawLocale === "fr" ? "fr" : "en";
  const since = /^\d{4}-\d{2}-\d{2}$/.test(query.since ?? "") ? (query.since as string) : daysAgo(60);
  const clientId = query.client?.trim() || null;
  const cover = COVER_CHOICES.includes(Number(query.cover)) ? Number(query.cover) : 14;
  const data = await loadAchats({ since, clientId, coverDays: cover });
  const shops = summarizeShops(data.pending);
  const toBuy = data.buy.filter((line) => line.toBuy > 0);
  const urgent = toBuy.filter((line) => line.urgent).length;
  const budget = toBuy.reduce((sum, line) => sum + (line.totalRmb ?? 0), 0);
  const unpriced = toBuy.filter((line) => line.factoryPriceRmb == null).length;
  const backlogPieces = data.buy.reduce((sum, line) => sum + line.backlog, 0);
  const oldest = data.pending.slice(0, 40);
  const params = (extra: Record<string, string>) => {
    const search = new URLSearchParams({ since, cover: String(cover), ...(clientId ? { client: clientId } : {}), ...extra });
    return search.toString();
  };
  const field = "rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-[13px]";
  const th = "px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-[var(--muted)] uppercase";
  const td = "px-3 py-2 align-top";
  const num = (value: number | null | undefined, digits = 0) => (value == null ? "—" : formatNumber(value, locale, digits));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">{t("kicker")}</p>
        <h1 className="font-display mt-2 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">{t("lead", { cover })}</p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--muted)]">{t("filters.client")}</span>
          <select name="client" defaultValue={clientId ?? ""} className={field}>
            <option value="">{t("filters.allClients")}</option>
            {data.clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--muted)]">{t("filters.since")}</span>
          <input type="date" name="since" defaultValue={since} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--muted)]">{t("filters.cover")}</span>
          <select name="cover" defaultValue={String(cover)} className={field}>
            {COVER_CHOICES.map((days) => (
              <option key={days} value={days}>
                {t("filters.coverDays", { days })}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="cursor-pointer rounded-lg bg-[var(--navy)] px-4 py-2 text-white">
          {t("filters.apply")}
        </button>
        <div className="flex flex-wrap gap-2 text-xs">
          {SINCE_CHOICES.map((days) => (
            <Link
              key={days}
              href={`/admin/achats?${params({ since: daysAgo(days) })}`}
              className={`rounded-full px-3 py-1.5 ring-1 ring-[var(--line)] ${since === daysAgo(days) ? "bg-[var(--navy)] text-white" : ""}`}
            >
              {t("filters.lastDays", { days })}
            </Link>
          ))}
        </div>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label={t("stats.orders")} value={num(data.pending.length)} />
        <Tile label={t("stats.pieces")} value={num(backlogPieces)} />
        <Tile label={t("stats.skusToBuy")} value={num(toBuy.length)} />
        <Tile label={t("stats.urgent")} value={num(urgent)} tone={urgent > 0 ? "rust" : undefined} />
        <Tile
          label={t("stats.budget")}
          value={`${num(Math.round(budget))} ¥`}
          hint={unpriced > 0 ? t("stats.unpriced", { count: unpriced }) : undefined}
        />
      </div>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{t("buy.title")}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("buy.lead", { cover, window: 14 })}</p>
          </div>
          <a href={`/api/admin/achats?${params({ type: "buy" })}`} className="rounded-lg px-3 py-1.5 text-xs ring-1 ring-[var(--line)]">
            {t("export")}
          </a>
        </div>
        {data.buy.length === 0 ? (
          <p className="px-5 py-6 text-sm text-[var(--muted)]">{t("buy.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-[13px]">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className={th}>{t("buy.product")}</th>
                  <th className={th}>{t("buy.client")}</th>
                  <th className={`${th} text-right`}>{t("buy.backlog")}</th>
                  <th className={`${th} text-right`}>{t("buy.perDay")}</th>
                  <th className={`${th} text-right`}>{t("buy.stock")}</th>
                  <th className={`${th} text-right`}>{t("buy.incoming")}</th>
                  <th className={`${th} text-right`}>{t("buy.leadTime")}</th>
                  <th className={`${th} text-right`}>{t("buy.runway")}</th>
                  <th className={`${th} text-right`}>{t("buy.toBuy")}</th>
                  <th className={`${th} text-right`}>{t("buy.price")}</th>
                  <th className={`${th} text-right`}>{t("buy.total")}</th>
                  <th className={th}>{t("buy.supplier")}</th>
                </tr>
              </thead>
              <tbody>
                {data.buy.slice(0, 300).map((line) => (
                  <tr key={`${line.clientId}|${line.sku}`} className="border-b border-[var(--line)] last:border-0">
                    <td className={td}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {line.productId ? (
                          <Link href={`/sourcer/${line.productId}`} className="font-medium hover:underline">
                            {line.title ?? line.sku}
                          </Link>
                        ) : (
                          <span className="font-medium">{line.title ?? line.sku}</span>
                        )}
                        {line.urgent ? <Badge tone="rust">{t("buy.urgent")}</Badge> : null}
                        {line.isUpsell ? <Badge tone="gold">{t("buy.upsell")}</Badge> : null}
                        {!line.productId ? <Badge tone="grey">{t("buy.noProduct")}</Badge> : null}
                      </div>
                      <p className="mt-0.5 text-[11px] text-[var(--muted)]">{line.sku}</p>
                    </td>
                    <td className={td}>{line.clientName}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {num(line.backlog)}
                      <span className="block text-[11px] text-[var(--muted)]">{t("buy.orders", { count: line.orders })}</span>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{num(line.perDay, 1)}</td>
                    <td className={`${td} text-right tabular-nums`}>{num(line.stock)}</td>
                    <td className={`${td} text-right tabular-nums`}>{line.incoming > 0 ? num(line.incoming) : "—"}</td>
                    <td className={`${td} text-right tabular-nums`}>{t("buy.days", { days: line.leadDays })}</td>
                    <td className={`${td} text-right tabular-nums`}>{line.runwayDays == null ? "—" : t("buy.days", { days: line.runwayDays })}</td>
                    <td className={`${td} text-right font-semibold tabular-nums`}>{line.toBuy > 0 ? num(line.toBuy) : "—"}</td>
                    <td className={`${td} text-right tabular-nums`}>{num(line.factoryPriceRmb, 2)}</td>
                    <td className={`${td} text-right tabular-nums`}>{line.totalRmb != null && line.toBuy > 0 ? num(Math.round(line.totalRmb)) : "—"}</td>
                    <td className={td}>{line.supplier ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-[var(--line)] px-5 py-3 text-xs text-[var(--muted)]">{t("buy.howto")}</p>
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{t("ship.title")}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("ship.lead", { since: formatDate(since, locale) })}</p>
          </div>
          <a href={`/api/admin/achats?${params({ type: "orders" })}`} className="rounded-lg px-3 py-1.5 text-xs ring-1 ring-[var(--line)]">
            {t("export")}
          </a>
        </div>
        {shops.length === 0 ? (
          <p className="px-5 py-6 text-sm text-[var(--muted)]">{t("ship.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-[13px]">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className={th}>{t("ship.shop")}</th>
                  <th className={`${th} text-right`}>{t("ship.orders")}</th>
                  <th className={`${th} text-right`}>{t("ship.units")}</th>
                  {AGE_BUCKETS.map((bucket) => (
                    <th key={bucket} className={`${th} text-right`}>
                      {t(`ship.age.${bucket}`)}
                    </th>
                  ))}
                  <th className={`${th} text-right`}>{t("ship.inEccang")}</th>
                  <th className={`${th} text-right`}>{t("ship.shipped")}</th>
                  <th className={`${th} text-right`}>{t("ship.flagged")}</th>
                </tr>
              </thead>
              <tbody>
                {shops.map((shop) => (
                  <tr key={shop.shopId} className="border-b border-[var(--line)] last:border-0">
                    <td className={td}>
                      <span className="font-medium">{shop.clientName}</span>
                      <span className="block text-[11px] text-[var(--muted)]">
                        {shop.shopDomain}
                        {shop.market ? ` · ${shop.market}` : ""}
                      </span>
                    </td>
                    <td className={`${td} text-right font-semibold tabular-nums`}>{num(shop.orders)}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {num(shop.units)}
                      {shop.unitsWithoutSku > 0 ? (
                        <span className="block text-[11px] text-[var(--rust-ink)]">{t("ship.noSku", { count: shop.unitsWithoutSku })}</span>
                      ) : null}
                    </td>
                    {AGE_BUCKETS.map((bucket) => (
                      <td
                        key={bucket}
                        className={`${td} text-right tabular-nums ${bucket === "d31" && shop.buckets[bucket] > 0 ? "text-[var(--rust-ink)]" : ""}`}
                      >
                        {shop.buckets[bucket] > 0 ? num(shop.buckets[bucket]) : "—"}
                      </td>
                    ))}
                    <td className={`${td} text-right tabular-nums`}>{shop.inEccang > 0 ? num(shop.inEccang) : "—"}</td>
                    <td className={`${td} text-right tabular-nums`}>{shop.shippedByEccang > 0 ? num(shop.shippedByEccang) : "—"}</td>
                    <td className={`${td} text-right tabular-nums`}>{shop.flagged > 0 ? num(shop.flagged) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-[var(--line)] px-5 py-3 text-xs text-[var(--muted)]">{t("ship.howto")}</p>
      </section>

      {oldest.length > 0 ? (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <div className="border-b border-[var(--line)] px-5 py-4">
            <h2 className="text-sm font-semibold">{t("oldest.title")}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("oldest.lead")}</p>
          </div>
          <ul className="divide-y divide-[var(--line)] text-[13px]">
            {oldest.map((order) => (
              <li key={`${order.shopId}:${order.orderId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2">
                <span className="w-16 font-medium">{order.name ?? order.orderId}</span>
                <span className="text-[var(--muted)]">
                  {order.clientName} · {order.shopDomain}
                </span>
                <span>{formatDate(order.date, locale)}</span>
                <Badge tone={order.ageDays > 30 ? "rust" : "grey"}>{t("buy.days", { days: order.ageDays })}</Badge>
                {order.partial ? <Badge tone="blue">{t("oldest.partial")}</Badge> : null}
                {order.flagged ? <Badge tone="rust">{t("oldest.flagged")}</Badge> : null}
                {order.eccang !== "none" ? <Badge tone="green">{t(`oldest.eccang.${order.eccang}`)}</Badge> : null}
                <span className="text-[var(--muted)]">
                  {order.lines.map((line) => `${line.quantity} × ${line.title ?? line.sku}`).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "rust" }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] px-4 py-3">
      <p className="text-[11px] font-semibold tracking-wide text-[var(--muted)] uppercase">{label}</p>
      <p className={`font-display mt-1 text-2xl font-extrabold tabular-nums ${tone === "rust" ? "text-[var(--rust-ink)]" : ""}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}
