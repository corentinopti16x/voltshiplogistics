import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { formatAmount, formatPercent } from "@/lib/format";
import type { MarginFlag, MarginTotals, VoltshipMargin } from "@/lib/pricing/margin";

/**
 * Server-rendered building blocks of the confidential "Marge Voltship" views.
 * Admin pages only — never import from a client-facing page.
 */

export async function ConfidentialTag() {
  const t = await getTranslations("admin.margin");
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--rust-ink)]/30 bg-[var(--rust-soft)] px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-[var(--rust-ink)] uppercase">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {t("confidential")}
    </span>
  );
}

/** Signed EUR amount coloured by sign; "—" for null. */
export function SignedAmount({
  value,
  locale,
  bold = false,
}: {
  value: number | null | undefined;
  locale: string;
  bold?: boolean;
}) {
  if (value == null || !Number.isFinite(value)) return <span className="text-[var(--faint)]">—</span>;
  const tone = value < 0 ? "text-[var(--rust-ink)]" : value > 0 ? "text-[var(--green-ink)]" : "text-[var(--ink)]";
  return <span className={`tabular ${tone} ${bold ? "font-bold" : ""}`}>{formatAmount(value, locale)}</span>;
}

export function Pct({ value, locale }: { value: number | null | undefined; locale: string }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-[var(--faint)]">—</span>;
  return <span className="tabular">{formatPercent(value, locale, 1)}</span>;
}

const flagTone: Record<MarginFlag, "rust" | "gold" | "green" | "grey"> = {
  factory_price_missing: "rust",
  carrier_cost_unknown: "rust",
  no_rate: "grey",
  carrier_cost_real: "green",
  carrier_cost_estimated: "gold",
};

/** Flags of one margin, the "estimated/real" ones included. */
export async function MarginFlags({ margin, compact = false }: { margin: VoltshipMargin; compact?: boolean }) {
  const t = await getTranslations("admin.margin.flags");
  const flags = compact
    ? margin.flags.filter((flag) => flag !== "carrier_cost_estimated" && flag !== "carrier_cost_real")
    : margin.flags;
  if (flags.length === 0 && margin.complete) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <Badge key={flag} tone={flagTone[flag]} className="whitespace-normal">
          {t(flag)}
        </Badge>
      ))}
      {!margin.complete && !flags.some((flag) => flag !== "carrier_cost_estimated" && flag !== "carrier_cost_real") ? (
        <Badge tone="grey">{t("partial")}</Badge>
      ) : null}
    </span>
  );
}

/** "3 réel · 12 estimé" style label from totals. */
export async function SourceLabel({ totals }: { totals: MarginTotals }) {
  const t = await getTranslations("admin.margin.source");
  const locale = await getLocale();
  const n = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  if (totals.real > 0 && totals.estimated > 0) {
    return <span>{t("mixed", { real: n(totals.real), estimated: n(totals.estimated) })}</span>;
  }
  if (totals.real > 0) return <Badge tone="green">{t("real")}</Badge>;
  if (totals.estimated > 0) return <Badge tone="gold">{t("estimated")}</Badge>;
  return <Badge tone="grey">{t("unknown")}</Badge>;
}

export function KpiTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "gold";
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        tone === "gold" ? "border-[#d8bf76] bg-[#fbf5df]" : "border-[var(--line)] bg-[var(--card)]"
      }`}
    >
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="font-display tabular mt-2 text-[26px] leading-tight font-extrabold tracking-[-0.02em]">{value}</p>
      {sub ? <p className="mt-2 text-xs text-[var(--muted)]">{sub}</p> : null}
    </div>
  );
}
