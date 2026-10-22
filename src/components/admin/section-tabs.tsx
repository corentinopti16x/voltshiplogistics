import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { countOpenOrderAlerts } from "@/lib/orders/alerts-queries";

export type SectionTab = { href: string; label: string; count?: number };

/** Pill tabs on top of the pages that share one menu entry (one rubrique, several views). */
// `spaced`: bottom margin for pages laid out without a flex gap.
export function SectionTabs({ tabs, active, spaced = true }: { tabs: SectionTab[]; active: string; spaced?: boolean }) {
  const tab = (selected: boolean) =>
    `rounded-full px-4 py-1.5 text-sm ${selected ? "bg-[var(--navy)] text-white" : "text-[var(--muted)] ring-1 ring-[var(--line)] hover:text-[var(--ink)]"}`;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${spaced ? "mb-6" : ""}`}>
      {tabs.map((item) => (
        <Link key={item.href} href={item.href} className={tab(item.href === active)}>
          {item.label}
          {item.count && item.count > 0 ? (
            <span className="ml-1.5 rounded-full bg-[var(--rust-soft)] px-1.5 text-[11px] font-bold text-[var(--rust-ink)]">
              {item.count}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

/**
 * « Achats & expéditions »: what to buy / ship, the orders to review before sending, and the
 * carrier lines the parcels actually left on.
 */
export async function OperationsTabs({ active }: { active: "achats" | "alerts" | "lines" }) {
  const [t, alerts] = await Promise.all([getTranslations("admin.tabs.operations"), countOpenOrderAlerts().catch(() => 0)]);
  const hrefs = { achats: "/admin/achats", alerts: "/admin/alerts", lines: "/admin/lines" } as const;
  return (
    <SectionTabs
      spaced={false}
      active={hrefs[active]}
      tabs={[
        { href: hrefs.achats, label: t("achats") },
        { href: hrefs.alerts, label: t("alerts"), count: alerts },
        { href: hrefs.lines, label: t("lines") },
      ]}
    />
  );
}

/** « Résultats »: week by week (finance) and order by order (margin). */
export async function ResultsTabs({ active }: { active: "week" | "order" }) {
  const t = await getTranslations("admin.tabs.results");
  return (
    <SectionTabs
      active={active === "week" ? "/admin/finance" : "/admin/margin"}
      tabs={[
        { href: "/admin/finance", label: t("week") },
        { href: "/admin/margin", label: t("order") },
      ]}
    />
  );
}

/** « Clients »: the client list and their Shopify stores. */
export async function ClientsTabs({ active }: { active: "clients" | "shops" }) {
  const t = await getTranslations("admin.tabs.clients");
  return (
    <SectionTabs
      active={active === "clients" ? "/admin/clients" : "/admin/shops"}
      tabs={[
        { href: "/admin/clients", label: t("clients") },
        { href: "/admin/shops", label: t("shops") },
      ]}
    />
  );
}
