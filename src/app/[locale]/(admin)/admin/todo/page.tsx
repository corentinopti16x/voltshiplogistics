import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { loadProductTodo } from "@/lib/products/todo";
import { createProductFromShopifyAction, linkShopifyProductAction } from "@/app/actions/product-todo";
import { ProductPhoto } from "@/components/client/product-photo";
import { Badge } from "@/components/ui";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * "À compléter": every Shopify product of the connected shops that is not linked to a
 * Voltship product or lacks weight / client price / carrier / factory price.
 * Products that sold in the last 90 days are mandatory, the others optional.
 */
export default async function AdminProductTodoPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; all?: string }>;
}) {
  const [query, locale, t] = await Promise.all([searchParams, getLocale(), getTranslations("admin.todo")]);
  const showOptional = query.all === "1";
  const todo = await loadProductTodo({ clientId: query.client || undefined });
  const clients = [...new Map(todo.items.map((item) => [item.clientId, item.clientName])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const items = todo.items.filter((item) => showOptional || item.priority === "required");
  const fmtLocale = locale === "fr" ? "fr" : "en";
  const qs = (next: { client?: string; all?: boolean }) => {
    const params = new URLSearchParams();
    const client = next.client ?? query.client;
    if (client) params.set("client", client);
    if (next.all ?? showOptional) params.set("all", "1");
    const text = params.toString();
    return text ? `/admin/todo?${text}` : "/admin/todo";
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">{t("kicker")}</p>
        <h1 className="font-display mt-2 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">{t("lead")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="rust">{t("countRequired", { count: todo.required })}</Badge>
        <Badge tone="grey">{t("countOptional", { count: todo.optional })}</Badge>
        <span className="mx-2 h-4 w-px bg-[var(--line)]" />
        <Link
          href={qs({ all: !showOptional })}
          className="rounded-full border border-[var(--line)] px-3 py-1 text-[13px] hover:bg-[var(--card)]"
        >
          {showOptional ? t("hideOptional") : t("showOptional")}
        </Link>
        <span className="mx-2 h-4 w-px bg-[var(--line)]" />
        <Link
          href={qs({ client: "" })}
          className={`rounded-full px-3 py-1 text-[13px] ${!query.client ? "bg-[var(--navy)] text-white" : "text-[var(--muted)]"}`}
        >
          {t("allClients")}
        </Link>
        {clients.map(([id, name]) => (
          <Link
            key={id}
            href={qs({ client: id })}
            className={`rounded-full px-3 py-1 text-[13px] ${query.client === id ? "bg-[var(--navy)] text-white" : "text-[var(--muted)]"}`}
          >
            {name}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-8 text-sm text-[var(--muted)]">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.key}
              className={`rounded-2xl border bg-[var(--card)] p-4 ${item.priority === "required" ? "border-[var(--rust-soft)]" : "border-[var(--line)]"}`}
            >
              <div className="flex flex-wrap items-start gap-4">
                <ProductPhoto src={item.photoUrl} alt={item.title} className="h-16 w-16 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={item.priority === "required" ? "rust" : "grey"}>
                      {item.priority === "required" ? t("required") : t("optional")}
                    </Badge>
                    <span className="text-[12px] text-[var(--muted)]">
                      {item.clientName} · {item.shopDomain.replace(".myshopify.com", "")}
                    </span>
                  </div>
                  <p className="mt-1 font-semibold">{item.title}</p>
                  <p className="mt-0.5 text-[12px] text-[var(--muted)]">
                    {t("sales90", { count: formatNumber(item.units90d, fmtLocale) })}
                    {item.skus.length ? ` · SKU ${item.skus.slice(0, 4).join(", ")}${item.skus.length > 4 ? "…" : ""}` : ` · ${t("noSku")}`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.missing.map((field) => (
                      <Badge key={field} tone="outline">
                        {t(`missing.${field}`)}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[300px]">
                  {item.productId ? (
                    <Link
                      href={`/sourcer/${item.productId}?from=todo`}
                      className="rounded-lg bg-[var(--navy)] px-4 py-2 text-center text-sm font-semibold text-white"
                    >
                      {t("complete")}
                    </Link>
                  ) : (
                    <>
                      <form action={createProductFromShopifyAction}>
                        <input type="hidden" name="shop_id" value={item.shopId} />
                        <input type="hidden" name="shopify_product_id" value={item.shopifyProductId} />
                        <input type="hidden" name="locale" value={locale} />
                        <button className="w-full rounded-lg bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white">
                          {t("create")}
                        </button>
                      </form>
                      {item.candidates.length > 0 ? (
                        <form action={linkShopifyProductAction} className="flex gap-2">
                          <input type="hidden" name="shop_id" value={item.shopId} />
                          <input type="hidden" name="shopify_product_id" value={item.shopifyProductId} />
                          <select
                            name="product_id"
                            required
                            defaultValue={item.candidates[0].score >= 0.3 ? item.candidates[0].id : ""}
                            className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-2 text-[13px]"
                          >
                            <option value="">{t("linkPlaceholder")}</option>
                            {item.candidates.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.score >= 0.3 ? "★ " : ""}
                                {candidate.title}
                                {candidate.sku ? ` (${candidate.sku})` : ""}
                              </option>
                            ))}
                          </select>
                          <button className="rounded-lg border border-[var(--line)] px-3 py-2 text-[13px] font-semibold">
                            {t("link")}
                          </button>
                        </form>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-[var(--faint)]">{t("footnote")}</p>
    </div>
  );
}
