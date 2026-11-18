import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui";
import { SourcerShell } from "@/components/sourcer/sourcer-shell";
import { Link, redirect } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { formatDate, formatNumber } from "@/lib/format";
import { loadAchats } from "@/lib/orders/to-ship-server";
import type { PendingOrder } from "@/lib/orders/to-ship";

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

type Cause = "sku" | "address" | "stock" | "transport" | "draft" | "missing" | "other";

/** Reason shown in both languages, whatever the page language (team rule). */
const CAUSE: Record<Cause, { label: string; action: string }> = {
  sku: { label: "无SKU · SKU manquant", action: "创建SKU · Créer le SKU" },
  address: { label: "地址不完整 · Adresse incomplète", action: "向客户要地址 · Demander l'adresse au client" },
  stock: { label: "缺货 · Rupture", action: "去采购 · Voir « À acheter »" },
  transport: { label: "物流失败 · Transport refusé", action: "换渠道或重试 · Changer de ligne ou retenter dans ECCANG" },
  draft: { label: "草稿待提交 · Brouillon à soumettre", action: "核对后提交 · Vérifier puis soumettre dans ECCANG" },
  missing: { label: "未进ECCANG · Pas dans ECCANG", action: "检查导入 · Vérifier l'import Shopify → ECCANG" },
  other: { label: "ECCANG异常 · Anomalie ECCANG", action: "查看原因 · Lire la raison dans ECCANG" },
};

function causeOfError(error: string): Cause {
  if (/地址|门牌|邮编|address|street|postcode|zip|city|州|省|house/i.test(error)) return "address";
  if (/库存|缺货|stock|inventory/i.test(error)) return "stock";
  if (/sku|产品不存在|商品不存在|product/i.test(error)) return "sku";
  if (/物流|跟踪号|预报|渠道|运输|shipping|label|carrier/i.test(error)) return "transport";
  return "other";
}

/** Why this order does not leave the warehouse, or null when nothing blocks it.
 * « Pas dans ECCANG » only for 2-6 day old orders: the ECCANG sync reads the last 7 days. */
function blockOf(order: PendingOrder): { cause: Cause; detail: string | null } | null {
  const skuLines = order.lines.filter((line) => isSkuless(line.sku) && !notGoods(line.title));
  if (skuLines.length > 0 || order.unitsWithoutSku > 0) {
    return { cause: "sku", detail: skuLines.map((line) => line.title ?? line.sku).join(" · ") || null };
  }
  const status = (order.eccangStatus ?? "").toUpperCase();
  if (status === "N" || status === "P") {
    const error = order.eccangError ?? "";
    return { cause: causeOfError(error), detail: error || null };
  }
  if (status === "C" && order.ageDays >= 1) return { cause: "draft", detail: null };
  // « Pas dans ECCANG » is not shown: the link Shopify order ↔ ECCANG order is not reliable yet
  // (orders imported by ECCANG itself carry another reference), it flagged hundreds of good orders.
  return null;
}

const CAUSE_ORDER: Cause[] = ["sku", "address", "stock", "transport", "draft", "missing", "other"];

/** Team page: one list of blocked orders (supply chain) and one buying list (buyer). */
export default async function TeamOrdersPage({ searchParams }: { searchParams: Promise<{ client?: string; tab?: string }> }) {
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
  const tab = query.tab === "buy" ? "buy" : "blocked";
  const clientId = query.client?.trim() || null;
  const data = await loadAchats({ since: daysAgo(60), clientId, coverDays: 14 });
  const num = (value: number | null | undefined, digits = 0) => (value == null ? "—" : formatNumber(value, locale, digits));
  const href = (next: { tab?: string; client?: string | null }) => {
    const params = new URLSearchParams();
    const nextTab = next.tab ?? tab;
    const nextClient = next.client === undefined ? clientId : next.client;
    if (nextTab === "buy") params.set("tab", "buy");
    if (nextClient) params.set("client", nextClient);
    const text = params.toString();
    return text ? `/sourcer/orders?${text}` : "/sourcer/orders";
  };

  const pending = data.pending.filter((order) => !isFakeClient(order.clientName));
  const clients = data.clients.filter((client) => !isFakeClient(client.name));
  const blocked: Array<{ order: PendingOrder; cause: Cause; detail: string | null }> = [];
  for (const order of pending) {
    const block = blockOf(order);
    if (block) blocked.push({ order, ...block });
  }
  blocked.sort((a, b) => CAUSE_ORDER.indexOf(a.cause) - CAUSE_ORDER.indexOf(b.cause) || b.order.ageDays - a.order.ageDays);
  const byCause = new Map<Cause, number>();
  for (const row of blocked) byCause.set(row.cause, (byCause.get(row.cause) ?? 0) + 1);

  const buy = data.buy
    .filter((line) => !isFakeClient(line.clientName) && !notGoods(line.title) && (line.toBuy > 0 || !line.productId))
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.toBuy - a.toBuy);

  const td = "px-3 py-2 align-top";
  const th = "px-3 py-2 text-left text-[11px] font-medium text-[var(--muted)]";
  const tabClass = (active: boolean) =>
    `rounded-lg px-4 py-2 text-sm font-semibold ${active ? "bg-[var(--navy)] text-white" : "ring-1 ring-[var(--line)]"}`;
  const button = "ml-auto rounded-lg bg-[var(--navy)] px-3 py-1 text-xs font-semibold text-white";

  return (
    <SourcerShell role={ctx.role}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href({ tab: "blocked" })} className={tabClass(tab === "blocked")}>
            {t("tabs.blocked", { count: blocked.length })}
          </Link>
          <Link href={href({ tab: "buy" })} className={tabClass(tab === "buy")}>
            {t("tabs.buy", { count: buy.length })}
          </Link>
          <span className="mx-2 h-5 w-px bg-[var(--line)]" />
          <Link href={href({ client: null })} className={`rounded-lg px-3 py-1.5 text-xs ${clientId ? "" : "bg-[var(--line)]"}`}>
            {t("allClients")}
          </Link>
          {clients.map((client) => (
            <Link
              key={client.id}
              href={href({ client: client.id })}
              className={`rounded-lg px-3 py-1.5 text-xs ${clientId === client.id ? "bg-[var(--line)]" : ""}`}
            >
              {client.name}
            </Link>
          ))}
        </div>

        {tab === "blocked" ? (
          <section className="rounded-xl bg-[var(--card)] ring-1 ring-[var(--line)]">
            <div className="flex flex-wrap gap-2 border-b border-[var(--line)] px-5 py-3">
              {CAUSE_ORDER.filter((cause) => byCause.has(cause)).map((cause) => (
                <Badge key={cause} tone="rust">
                  {CAUSE[cause].label} · {byCause.get(cause)}
                </Badge>
              ))}
            </div>
            {blocked.length === 0 ? (
              <p className="px-5 py-8 text-sm text-[var(--muted)]">{t("blocked.empty")}</p>
            ) : (
              <ul className="divide-y divide-[var(--line)] text-sm">
                {blocked.slice(0, 300).map(({ order, cause, detail }) => (
                  <li key={`${order.shopId}:${order.orderId}`} className="flex flex-col gap-1 px-5 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold">{order.name ?? order.orderId}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {order.clientName} · {formatDate(order.date, locale)} · {t("blocked.age", { days: order.ageDays })}
                      </span>
                      <Badge tone="rust">{CAUSE[cause].label}</Badge>
                      {cause === "sku" ? (
                        <Link href="/sourcer/skus" className={button}>
                          {CAUSE.sku.action}
                        </Link>
                      ) : cause === "stock" ? (
                        <Link href={href({ tab: "buy" })} className={button}>
                          {CAUSE.stock.action}
                        </Link>
                      ) : (
                        <span className="ml-auto text-xs font-medium">{CAUSE[cause].action}</span>
                      )}
                    </div>
                    {detail ? <p className="text-xs text-[var(--rust-ink)]">{detail}</p> : null}
                    <p className="text-xs text-[var(--muted)]">
                      {order.lines
                        .filter((line) => !notGoods(line.title))
                        .map((line) => `${line.quantity} × ${line.title ?? line.sku}${line.variant ? ` (${line.variant})` : ""}`)
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <section className="overflow-x-auto rounded-xl bg-[var(--card)] ring-1 ring-[var(--line)]">
            {buy.length === 0 ? (
              <p className="px-5 py-8 text-sm text-[var(--muted)]">{t("buy.empty")}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--line)]">
                  <tr>
                    <th className={th}>{t("products.product")}</th>
                    <th className={th}>{t("products.variants")}</th>
                    <th className={`${th} text-right`}>{t("products.toShip")}</th>
                    <th className={`${th} text-right`}>{t("products.stock")}</th>
                    <th className={`${th} text-right`}>{t("products.incoming")}</th>
                    <th className={`${th} text-right`}>{t("products.toBuy")}</th>
                    <th className={th}>{t("products.supplier")}</th>
                  </tr>
                </thead>
                <tbody>
                  {buy.map((line) => (
                    <tr key={`${line.clientId}|${line.sku}`} className="border-b border-[var(--line)] last:border-0">
                      <td className={td}>
                        <div className="flex items-start gap-3">
                          {line.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={line.photoUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover ring-1 ring-[var(--line)]" />
                          ) : (
                            <div className="h-14 w-14 shrink-0 rounded-lg bg-[var(--line)]" />
                          )}
                          <div>
                            {line.productId ? (
                              <Link href={`/sourcer/${line.productId}`} className="font-medium hover:underline">
                                {line.title ?? line.sku}
                              </Link>
                            ) : (
                              <span className="font-medium">{line.title ?? line.sku}</span>
                            )}
                            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                              {line.clientName} · {line.sku}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {line.urgent ? <Badge tone="rust">{t("products.urgent")}</Badge> : null}
                              {!line.productId ? <Badge tone="gold">{t("fresh.badge")}</Badge> : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className={`${td} text-xs`}>{line.variants.length ? line.variants.join(" · ") : "—"}</td>
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
            )}
          </section>
        )}
      </div>
    </SourcerShell>
  );
}
