import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { Badge } from "@/components/ui";
import { ProductPhoto } from "@/components/client/product-photo";
import { SourcingTabs } from "@/components/sourcer/sourcing-tabs";
import { applySkuFixAction } from "@/app/actions/sku-fix";
import { countRequiredTodo } from "@/lib/products/todo";
import { loadSkuFixList } from "@/lib/shopify/sku-fix";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * « SKU à corriger »: Shopify variants with no SKU, or with the SKU of another item (pages
 * duplicated by the client). ECCANG matches order lines by SKU only, so they must be fixed.
 * The admin ticks the proposals and the app writes them into the client's store.
 */
export default async function AdminSkuFixPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; all?: string; done?: string; failed?: string; errors?: string }>;
}) {
  const [query, locale, t] = await Promise.all([searchParams, getLocale(), getTranslations("admin.skuFix")]);
  const showAll = query.all === "1";
  const [list, todoCount] = await Promise.all([
    loadSkuFixList({ clientId: query.client || null, all: showAll }),
    countRequiredTodo().catch(() => 0),
  ]);
  const fmtLocale = locale === "fr" ? "fr" : "en";
  const qs = (next: { client?: string; all?: boolean }) => {
    const params = new URLSearchParams();
    const client = next.client ?? query.client;
    if (client) params.set("client", client);
    if (next.all ?? showAll) params.set("all", "1");
    const text = params.toString();
    return text ? `/admin/skus?${text}` : "/admin/skus";
  };
  const th = "px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-[var(--muted)] uppercase";
  const td = "px-3 py-2 align-top";

  return (
    <div className="flex flex-col gap-5">
      <SourcingTabs active="skus" showTodo todoCount={todoCount} skuCount={list.sold} />
      <div>
        <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">{t("kicker")}</p>
        <h1 className="font-display mt-2 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">{t("lead")}</p>
      </div>

      {query.done ? (
        <p
          className={`rounded-xl px-4 py-3 text-sm ${Number(query.failed ?? 0) > 0 ? "bg-[var(--rust-soft)] text-[var(--rust-ink)]" : "bg-emerald-50 text-emerald-800"}`}
        >
          {t("result", { done: Number(query.done), failed: Number(query.failed ?? 0) })}
          {query.errors ? <span className="mt-1 block text-[12px]">{query.errors}</span> : null}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="rust">{t("countSold", { count: list.sold })}</Badge>
        <Badge tone="grey">{t("countTotal", { count: list.total })}</Badge>
        <span className="mx-2 h-4 w-px bg-[var(--line)]" />
        <Link
          href={qs({ all: !showAll })}
          className="rounded-full border border-[var(--line)] px-3 py-1 text-[13px] hover:bg-[var(--card)]"
        >
          {showAll ? t("onlySold") : t("showAll")}
        </Link>
        <span className="mx-2 h-4 w-px bg-[var(--line)]" />
        <Link
          href={qs({ client: "" })}
          className={`rounded-full px-3 py-1 text-[13px] ${!query.client ? "bg-[var(--navy)] text-white" : "text-[var(--muted)]"}`}
        >
          {t("allClients")}
        </Link>
        {list.clients.map((client) => (
          <Link
            key={client.id}
            href={qs({ client: client.id })}
            className={`rounded-full px-3 py-1 text-[13px] ${query.client === client.id ? "bg-[var(--navy)] text-white" : "text-[var(--muted)]"}`}
          >
            {client.name}
          </Link>
        ))}
      </div>

      {!query.client && list.items.length > 0 ? (
        <p className="rounded-xl bg-[var(--card)] px-4 py-3 text-[13px] text-[var(--muted)]">{t("pickClient")}</p>
      ) : null}

      {list.liveErrors.length ? (
        <p className="rounded-xl border border-[var(--rust-soft)] px-4 py-3 text-[13px] text-[var(--rust-ink)]">
          {t("liveError")} {list.liveErrors.join(" · ")}
        </p>
      ) : null}

      {list.items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-8 text-sm text-[var(--muted)]">
          {t("empty")}
        </p>
      ) : (
        <form action={applySkuFixAction} className="flex flex-col gap-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="client" value={query.client ?? ""} />
          <input type="hidden" name="all" value={showAll ? "1" : ""} />
          <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)]">
            <table className="w-full text-[13px]">
              <thead className="border-b border-[var(--line)]">
                <tr>
                  <th className={th}>{t("cols.pick")}</th>
                  <th className={th}>{t("cols.product")}</th>
                  <th className={th}>{t("cols.sales")}</th>
                  <th className={th}>{t("cols.current")}</th>
                  <th className={th}>{t("cols.newSku")}</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((item) => (
                  <tr key={item.key} className="border-b border-[var(--line)] last:border-0">
                    <td className={td}>
                      <input
                        type="checkbox"
                        name="pick"
                        value={item.key}
                        defaultChecked={
                          Boolean(query.client) &&
                          item.kind === "missing" &&
                          !item.alreadyFixed &&
                          !item.service &&
                          item.units90d > 0
                        }
                        disabled={item.alreadyFixed}
                        className="mt-1 h-4 w-4"
                      />
                    </td>
                    <td className={td}>
                      <div className="flex items-start gap-3">
                        <ProductPhoto src={item.photoUrl} alt={item.productTitle} className="h-10 w-10 shrink-0 rounded-lg" />
                        <div className="min-w-0">
                          <p className="font-medium">{item.productTitle}</p>
                          <p className="text-[12px] text-[var(--muted)]">
                            {item.variantTitle ? `${item.variantTitle} · ` : ""}
                            {item.clientName} · {item.shopDomain.replace(".myshopify.com", "")}
                          </p>
                          {item.service ? <p className="text-[11px] text-[var(--muted)]">{t("service")}</p> : null}
                        </div>
                      </div>
                    </td>
                    <td className={`${td} tabular-nums`}>{formatNumber(item.units90d, fmtLocale)}</td>
                    <td className={td}>
                      {item.alreadyFixed ? (
                        <Badge tone="grey">{t("alreadyFixed", { sku: item.currentSku ?? "" })}</Badge>
                      ) : item.kind === "missing" ? (
                        <Badge tone="rust">{t("missing")}</Badge>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <code className="text-[12px]">{item.currentSku}</code>
                          <span className="text-[11px] text-[var(--rust-ink)]">
                            {item.sharedWith.length
                              ? t("sharedWith", { titles: item.sharedWith.slice(0, 2).join(" · ") })
                              : t("shared")}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className={td}>
                      <input
                        type="text"
                        name={`sku_${item.key}`}
                        defaultValue={item.proposal}
                        className="w-full min-w-[220px] rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 font-mono text-[12px]"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="rounded-lg bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white">{t("write")}</button>
            <p className="text-[12px] text-[var(--muted)]">{t("writeHint")}</p>
          </div>
        </form>
      )}
    </div>
  );
}
