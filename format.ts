/** Locale-aware number formatting shared by the client portal. */
export function formatNumber(value: number | null | undefined, locale: string, digits = 0) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * Money. Voltship bills clients in EUR and rate grids are stored in EUR, so EUR is the
 * default; pass `null` to format a bare number (e.g. a selling price in the shop currency).
 */
export function formatAmount(
  value: number | null | undefined,
  locale: string,
  currency: "EUR" | "USD" | null = "EUR",
) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (currency) {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return formatNumber(value, locale, 2);
}

export function formatRatio(value: number | null | undefined, locale: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatNumber(value, locale, 2);
}

export function formatPercent(value: number | null | undefined, locale: string, digits = 0) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDays(value: number | null | undefined, locale: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatNumber(Math.max(0, Math.floor(value)), locale, 0);
}

export function formatDate(value: string | Date, locale: string, withTime = false) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}
