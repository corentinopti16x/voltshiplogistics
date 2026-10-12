import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";

/**
 * « Sourcing » rubrique: client requests (queue) and Shopify products to complete, one place.
 * The « À compléter » tab is admin-only (its page lives under /admin).
 */
export async function SourcingTabs({
  active,
  showTodo,
  todoCount = 0,
}: {
  active: "queue" | "todo";
  showTodo: boolean;
  todoCount?: number;
}) {
  const t = await getTranslations("sourcer.tabs");
  const tab = (selected: boolean) =>
    `rounded-full px-4 py-1.5 text-sm ${selected ? "bg-[var(--navy)] text-white" : "text-[var(--muted)] ring-1 ring-[var(--line)] hover:text-[var(--ink)]"}`;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <Link href="/sourcer" className={tab(active === "queue")}>
        {t("queue")}
      </Link>
      {showTodo ? (
        <Link href="/admin/todo" className={tab(active === "todo")}>
          {t("todo")}
          {todoCount > 0 ? (
            <span className="ml-1.5 rounded-full bg-[var(--rust-soft)] px-1.5 text-[11px] font-bold text-[var(--rust-ink)]">
              {todoCount}
            </span>
          ) : null}
        </Link>
      ) : null}
    </div>
  );
}
