/**
 * Delivery countries of a store, stored in `shops.market` as "FR,BE,CH,LU": the main country
 * first, then the other countries the store also ships to (a French store usually also sells
 * to the French-speaking countries). Pure, unit-tested.
 */

export const MAIN_MARKETS = ["FR", "US", "IT", "DE", "ES", "BE", "NL", "PT", "AT", "CH", "GB", "CA", "AU"] as const;
export const EXTRA_MARKETS = ["BE", "CH", "LU", "FR", "CA", "DE", "IT", "ES", "NL", "AT", "PT", "GB", "IE", "US"] as const;

/** French-speaking countries offered first for a French store. */
export const FRANCOPHONE_MARKETS = ["BE", "CH", "LU"] as const;

export const MARKET_FLAGS: Record<string, string> = {
  FR: "🇫🇷", US: "🇺🇸", IT: "🇮🇹", DE: "🇩🇪", ES: "🇪🇸", BE: "🇧🇪", NL: "🇳🇱", PT: "🇵🇹", AT: "🇦🇹",
  CH: "🇨🇭", GB: "🇬🇧", CA: "🇨🇦", AU: "🇦🇺", LU: "🇱🇺", IE: "🇮🇪",
};

/** "FR,BE,ch" → ["FR","BE","CH"] (main first, no duplicates, ISO-2 only). */
export function parseShopMarkets(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? "").split(/[,;/|\s]+/)) {
    const code = part.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

/** Main country + extra countries → stored value ("" when no main country). */
export function formatShopMarkets(main: string, extras: string[]) {
  const markets = parseShopMarkets([main, ...extras].join(","));
  return parseShopMarkets(main).length === 0 ? "" : markets.join(",");
}

export function marketLabel(code: string) {
  return `${MARKET_FLAGS[code] ?? ""} ${code}`.trim();
}
