import { useTranslations } from "next-intl";
import type { BuyLine } from "@/lib/orders/to-ship";

/**
 * « Combien en acheter ? » on the sourcing sheet: the same buying plan as the admin page
 * Achats & expéditions, for this product only (all its SKUs). Orders still to send + daily
 * sales × (lead time + cover) − stock − incoming.
 */
export function BuyAdvice({ lines, locale, coverDays }: { lines: BuyLine[]; locale: string; coverDays: number }) {
  const t = useTranslations("sourcer.buy");
  const num = (value: number) => Math.round(value).toLocaleString(locale);
  if (lines.length === 0) {
    return (
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <p className="mt-2 text-xs text-[var(--muted)]">{t("empty")}</p>
      </section>
    );
  }
  const total = lines.reduce((sum, line) => sum + Math.max(0, line.toBuy), 0);
  const urgent = lines.some((line) => line.urgent && line.toBuy > 0);
  const sum = (key: "backlog" | "perDay" | "incoming") => lines.reduce((acc, line) => acc + line[key], 0);
  const stock = lines.every((line) => line.stock == null) ? null : lines.reduce((acc, line) => acc + (line.stock ?? 0), 0);
  const lead = Math.max(...lines.map((line) => line.leadDays));
  return (
    <section
      className={`rounded-2xl border p-5 ${urgent ? "border-[#f5c2bb] bg-[#fff7f5]" : "border-[var(--line)] bg-[var(--card)]"}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        {urgent ? <span className="rounded-full bg-[#fdecea] px-2 py-0.5 text-[11px] font-semibold text-[#b42318]">{t("urgent")}</span> : null}
      </div>
      <p className="font-display mt-1 text-3xl tabular-nums">{total > 0 ? t("pieces", { count: num(total) }) : t("nothing")}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        <Row label={t("backlog")} value={num(sum("backlog"))} />
        <Row label={t("perDay")} value={sum("perDay").toLocaleString(locale, { maximumFractionDigits: 1 })} />
        <Row label={t("stock")} value={stock == null ? "—" : num(stock)} />
        <Row label={t("incoming")} value={num(sum("incoming"))} />
        <Row label={t("leadTime")} value={t("days", { days: lead })} />
        <Row label={t("cover")} value={t("days", { days: coverDays })} />
      </dl>
      {lines.length > 1 ? (
        <ul className="mt-3 space-y-0.5 text-[11px] text-[var(--muted)]">
          {lines.map((line) => (
            <li key={line.sku}>
              <span className="font-mono">{line.sku}</span> · {t("pieces", { count: num(Math.max(0, line.toBuy)) })}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-[11px] text-[var(--muted)]">{t("howto")}</p>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-[var(--line)] py-1 last:border-0">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
