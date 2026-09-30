"use client";

import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";

export function LanguageSwitcher({ tone = "light" }: { tone?: "light" | "dark" }) {
  const locale = useLocale();
  const pathname = usePathname();
  const dark = tone === "dark";

  return (
    <div className="flex items-center gap-1 text-xs font-medium tracking-wide">
      <Link
        href={pathname}
        locale="en"
        className={
          locale === "en"
            ? dark
              ? "text-white"
              : "text-[var(--ink)]"
            : dark
              ? "text-white/45 hover:text-white"
              : "text-[var(--muted)] hover:text-[var(--ink)]"
        }
      >
        EN
      </Link>
      <span className={dark ? "text-white/25" : "text-[var(--line)]"}>/</span>
      <Link
        href={pathname}
        locale="fr"
        className={
          locale === "fr"
            ? dark
              ? "text-white"
              : "text-[var(--ink)]"
            : dark
              ? "text-white/45 hover:text-white"
              : "text-[var(--muted)] hover:text-[var(--ink)]"
        }
      >
        FR
      </Link>
    </div>
  );
}
