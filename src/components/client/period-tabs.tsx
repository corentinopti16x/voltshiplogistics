import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { DASHBOARD_PERIODS, type DashboardPeriod } from "@/lib/products/periods";

/** 24 h · 7 jours · 30 jours switch; keeps the other query params of the page. */
export async function PeriodTabs({
  basePath,
  period,
  label,
  params = {},
}: {
  basePath: string;
  period: DashboardPeriod;
  label: string;
  params?: Record<string, string>;
}) {
  const t = await getTranslations("periods");
  return (
    <nav
      aria-label={label}
      className="flex gap-1 rounded-full border border-[var(--line)] bg-white p-1 shadow-sm"
    >
      {DASHBOARD_PERIODS.map((key) => {
        const query = new URLSearchParams({ ...params, period: key }).toString();
        return (
          <Link
            key={key}
            href={`${basePath}?${query}`}
            aria-current={key === period ? "true" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold transition ${
              key === period
                ? "bg-[var(--navy)] text-white"
                : "text-[var(--muted)] hover:bg-[var(--card-soft)]"
            }`}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
