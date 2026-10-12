import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";

/**
 * « Sourcing » rubrique: client requests (queue), Shopify products to complete and Shopify
 * variants whose SKU must be fixed, one place. The two last tabs are admin-only (pages under /admin).
 */
export async function SourcingTabs({
  active,
  showTodo,
  todoCount = 0,
  skuCount = 0,
}: {
  active: "queue" | "todo" | "skus";
  showTodo: boolean;
  todoCount?: number;
  skuCount?: number;
}) {
  const t = await getTranslations("sourcer.tabs");
  const tab = (selected: boolean) =>
    `rounded-full px-4 py-1.5 text-sm ${selected ? "bg-[var(--navy)] text-white" : "text-[var(--muted)] ring-1 ring-[var(--line)] hover:text-[var(--ink)]"}`;
  const count = (value: number) =>
    value > 0 ? (
      <span className="ml-1.5 rounded-full bg-[var(--rust-soft)] px-1.5 text-[11px] font-bold text-[var(--rust-ink)]">
        {value}
      </span>
    ) : null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <Link href="/sourcer" className={tab(active === "queue")}>
        {t("queue")}
      </Link>
      {showTodo ? (
        <>
          <Link href="/admin/todo" className={tab(active === "todo")}>
            {t("todo")}
            {count(todoCount)}
          </Link>
          <Link href="/admin/skus" className={tab(active === "skus")}>
            {t("skus")}
            {count(skuCount)}
          </Link>
        </>
      ) : null}
    </div>
  );
}
