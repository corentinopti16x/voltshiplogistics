"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";

type NavItem = { href: string; key: string };
type NavGroup = { key: string; href?: string; items?: NavItem[] };

/**
 * Admin menu in 5 sections: Accueil · Opérations ▾ · Produits ▾ · Clients · Argent ▾.
 * Pages of the same rubrique are tabs on the page itself (SectionTabs / SourcingTabs), not menu entries:
 * Achats & expéditions + À vérifier, Sourcing + À compléter, Clients + Boutiques Shopify, Résultats (semaine + commande).
 */
const groups: NavGroup[] = [
  { key: "dashboard", href: "/admin" },
  {
    key: "operations",
    items: [
      { href: "/admin/achats", key: "achats" },
      { href: "/admin/orders", key: "orders" },
    ],
  },
  {
    key: "products",
    items: [
      { href: "/sourcer/products", key: "catalog" },
      { href: "/sourcer", key: "sourcing" },
    ],
  },
  { key: "clients", href: "/admin/clients" },
  {
    key: "money",
    items: [
      { href: "/admin/finance", key: "results" },
      { href: "/admin/pricing", key: "pricing" },
    ],
  },
];

/** Other pages shown as a tab of a menu entry. */
const TAB_OF: Record<string, string[]> = {
  "/admin/achats": ["/admin/alerts"],
  "/sourcer": ["/admin/todo", "/admin/skus"],
  "/admin/clients": ["/admin/shops"],
  "/admin/finance": ["/admin/margin"],
};

function matches(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isActive(href: string, pathname: string) {
  if (href === "/admin") return pathname === href;
  if (href === "/sourcer" && pathname.startsWith("/sourcer/products")) return false;
  return matches(href, pathname) || (TAB_OF[href] ?? []).some((tab) => matches(tab, pathname));
}

export function AdminNavLinks({ todoCount = 0, alertCount = 0 }: { todoCount?: number; alertCount?: number }) {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const countOf = (key: string) => (key === "sourcing" ? todoCount : key === "achats" ? alertCount : 0);
  const groupCount = (group: NavGroup) => (group.items ?? []).reduce((sum, item) => sum + countOf(item.key), 0);
  const label = (key: string) => (key === "dashboard" ? t("home") : t(key));

  useEffect(() => {
    if (!openGroup) return;
    const close = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) setOpenGroup(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenGroup(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [openGroup]);

  return (
    <>
      <nav ref={navRef} className="hidden items-center gap-1 text-sm md:flex">
        {groups.map((group) => {
          if (group.href) {
            const active = isActive(group.href, pathname);
            return (
              <Link
                key={group.key}
                href={group.href}
                className={`rounded-full px-3 py-1.5 ${active ? "bg-[var(--grey-soft)] font-medium text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
              >
                {label(group.key)}
              </Link>
            );
          }
          const active = (group.items ?? []).some((item) => isActive(item.href, pathname));
          const open = openGroup === group.key;
          const count = groupCount(group);
          return (
            <div key={group.key} className="relative">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenGroup(open ? null : group.key)}
                className={`flex cursor-pointer items-center gap-1 rounded-full px-3 py-1.5 ${active ? "bg-[var(--grey-soft)] font-medium text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
              >
                {t(`groups.${group.key}`)}
                {count > 0 ? <Count value={count} /> : null}
                <span aria-hidden className="text-[10px]">
                  ▾
                </span>
              </button>
              {open ? (
                <div className="absolute top-full left-0 z-30 mt-2 min-w-[220px] rounded-xl border border-[var(--line)] bg-[var(--card)] p-1.5 shadow-lg">
                  {(group.items ?? []).map((item) => (
                    <Link
                      key={item.key}
                      href={item.href}
                      onClick={() => setOpenGroup(null)}
                      className={`flex items-center justify-between rounded-lg px-3 py-2 ${isActive(item.href, pathname) ? "bg-[var(--grey-soft)] font-medium text-[var(--ink)]" : "text-[var(--muted)] hover:bg-[var(--grey-soft)] hover:text-[var(--ink)]"}`}
                    >
                      {label(item.key)}
                      {countOf(item.key) > 0 ? <Count value={countOf(item.key)} /> : null}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
      <button
        type="button"
        className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm md:hidden"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((current) => !current)}
      >
        {mobileOpen ? t("close") : t("menu")}
      </button>
      {mobileOpen ? (
        <nav className="absolute inset-x-0 top-full z-20 flex flex-col gap-4 border-b border-[var(--line)] bg-[var(--card)] px-6 py-4 text-sm md:hidden">
          {groups.map((group) =>
            group.href ? (
              <Link key={group.key} href={group.href} onClick={() => setMobileOpen(false)} className="font-medium">
                {label(group.key)}
              </Link>
            ) : (
              <div key={group.key} className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold tracking-[0.15em] text-[var(--muted)] uppercase">
                  {t(`groups.${group.key}`)}
                </p>
                {(group.items ?? []).map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={isActive(item.href, pathname) ? "font-medium text-[var(--ink)]" : "text-[var(--muted)]"}
                  >
                    {label(item.key)}
                    {countOf(item.key) > 0 ? <Count value={countOf(item.key)} /> : null}
                  </Link>
                ))}
              </div>
            ),
          )}
        </nav>
      ) : null}
    </>
  );
}

function Count({ value }: { value: number }) {
  return (
    <span className="ml-1 rounded-full bg-[var(--rust-soft)] px-1.5 text-[11px] font-bold text-[var(--rust-ink)]">
      {value}
    </span>
  );
}
