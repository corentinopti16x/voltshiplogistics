"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";

const items = [
  { href: "/dashboard", key: "dashboard" },
  { href: "/products", key: "products" },
  { href: "/inbound", key: "inbound" },
  { href: "/notifications", key: "notifications" },
  { href: "/settings", key: "settings" },
] as const;

export function ClientNavLinks({ showSettings = true }: { showSettings?: boolean }) {
  const t = useTranslations("dashboard.nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const links = showSettings ? items : items.filter((item) => item.key !== "settings");

  return (
    <>
      <nav className="hidden items-center gap-5 text-sm md:flex">
        {links.map((item) => (
          <NavItem key={item.key} href={item.href} pathname={pathname} label={t(item.key)} />
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
          {links.map((item) => (
            <NavItem
              key={item.key}
              href={item.href}
              pathname={pathname}
              label={t(item.key)}
              onNavigate={() => setOpen(false)}
            />
          ))}
        </nav>
      ) : null}
    </>
  );
}

function NavItem({
  href,
  pathname,
  label,
  onNavigate,
}: {
  href: (typeof items)[number]["href"];
  pathname: string;
  label: string;
  onNavigate?: () => void;
}) {
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={active ? "font-medium text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}
    >
      {label}
    </Link>
  );
}
