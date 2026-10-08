"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";

const items = [
  { href: "/admin", key: "dashboard" },
  { href: "/admin/clients", key: "clients" },
  { href: "/admin/pricing", key: "pricing" },
  { href: "/admin/margin", key: "margin" },
  { href: "/admin/finance", key: "finance" },
  { href: "/admin/todo", key: "todo" },
  { href: "/admin/orders", key: "orders" },
  { href: "/admin/shops", key: "shopify" },
  { href: "/admin/alerts", key: "alerts" },
  { href: "/sourcer", key: "sourcing" },
] as const;

export function AdminNavLinks({ todoCount = 0 }: { todoCount?: number }) {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav className="hidden items-center gap-4 text-sm md:flex">
        {items.map((item) => (
          <NavItem key={item.key} item={item} pathname={pathname} label={t(item.key)} count={item.key === "todo" ? todoCount : 0} />
        ))}
      </nav>
      <button
        type="button"
        className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm md:hidden"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? t("close") : t("menu")}
      </button>
      {open ? (
        <nav className="absolute inset-x-0 top-full z-20 flex flex-col gap-3 border-b border-[var(--line)] bg-[var(--card)] px-6 py-4 text-sm md:hidden">
          {items.map((item) => (
            <NavItem
              key={item.key}
              item={item}
              pathname={pathname}
              label={t(item.key)}
              count={item.key === "todo" ? todoCount : 0}
              onNavigate={() => setOpen(false)}
            />
          ))}
        </nav>
      ) : null}
    </>
  );
}

function NavItem({
  item,
  pathname,
  label,
  count = 0,
  onNavigate,
}: {
  item: (typeof items)[number];
  pathname: string;
  label: string;
  count?: number;
  onNavigate?: () => void;
}) {
  const active =
    item.href === "/admin"
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={active ? "font-medium text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}
    >
      {label}
      {count > 0 ? (
        <span className="ml-1 rounded-full bg-[var(--rust-soft)] px-1.5 text-[11px] font-bold text-[var(--rust-ink)]">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
