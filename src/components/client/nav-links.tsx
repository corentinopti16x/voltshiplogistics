"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";

const items = [
  { href: "/dashboard", key: "dashboard" },
  { href: "/products", key: "products" },
  { href: "/inbound", key: "inbound" },
  { href: "/support", key: "support" },
  { href: "/notifications", key: "notifications" },
  { href: "/settings", key: "settings" },
] as const;

export function ClientNavLinks({
  showSettings = true,
  showInbound = true,
  showSupport = true,
}: {
  showSettings?: boolean;
  /** Réceptions only once the warehouse (ECCANG) is live for the client. */
  showInbound?: boolean;
  /** SAV only once the client has connected a mailbox. */
  showSupport?: boolean;
}) {
  const t = useTranslations("dashboard.nav");
  const pathname = usePathname();
  const links = items.filter(
    (item) =>
      (showSettings || item.key !== "settings") &&
      (showInbound || item.key !== "inbound") &&
      (showSupport || item.key !== "support"),
  );

  return (
    <nav
      aria-label={t("label")}
      className="order-last flex w-full flex-wrap gap-1 md:order-none md:w-auto md:flex-1"
    >
      {links.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition sm:px-3.5 ${
              active ? "bg-white/14 text-white" : "text-white/72 hover:bg-white/8 hover:text-white"
            }`}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
