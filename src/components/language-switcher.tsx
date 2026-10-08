"use client";

import { Fragment } from "react";
import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";

/** EN / FR everywhere; 中文 only on the Voltship team pages (admin, sourcing). */
export function LanguageSwitcher({
  tone = "light",
  withChinese = false,
}: {
  tone?: "light" | "dark";
  withChinese?: boolean;
}) {
  const locale = useLocale();
  const pathname = usePathname();
  const dark = tone === "dark";
  const options: Array<{ locale: "en" | "fr" | "zh"; label: string }> = [
    { locale: "en", label: "EN" },
    { locale: "fr", label: "FR" },
    ...(withChinese ? [{ locale: "zh" as const, label: "中文" }] : []),
  ];

  return (
    <div className="flex items-center gap-1 text-xs font-medium tracking-wide">
      {options.map((option, index) => (
        <Fragment key={option.locale}>
          {index > 0 ? <span className={dark ? "text-white/25" : "text-[var(--line)]"}>/</span> : null}
          <Link
            href={pathname}
            locale={option.locale}
            className={
              locale === option.locale
                ? dark
                  ? "text-white"
                  : "text-[var(--ink)]"
                : dark
                  ? "text-white/45 hover:text-white"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
            }
          >
            {option.label}
          </Link>
        </Fragment>
      ))}
    </div>
  );
}
