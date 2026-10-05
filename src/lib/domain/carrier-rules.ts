import { lineKey, normalizeDestination, type CarrierLineRef, type RateCell } from "./pricing";

/**
 * Admin restrictions stored in `clients.carrier_rules_json`:
 *   { blocked: ["YunExpress|THPHR-CHC", …], forced?: { FR: { carrier, lineName } } }
 * A blocked line is never picked (nor offered); a forced line replaces the client's own
 * preference on that market (the engine still falls back to the cheapest allowed line
 * when the forced line has no bracket at the parcel weight).
 */
export type CarrierRules = {
  blocked: string[];
  forced: Record<string, CarrierLineRef>;
};

export const EMPTY_CARRIER_RULES: CarrierRules = { blocked: [], forced: {} };

/** Product-level choice stored in `products_cache.quote_json._carrier_pref`: { FR: { carrier, lineName } }. */
export type CarrierPreferences = Record<string, CarrierLineRef>;

export const CARRIER_PREF_KEY = "_carrier_pref";

function parseLineRef(raw: unknown): CarrierLineRef | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const carrier = typeof row.carrier === "string" ? row.carrier.trim() : "";
  if (!carrier) return null;
  const lineName = typeof row.lineName === "string" ? row.lineName.trim() : "";
  return { carrier, lineName: lineName || null };
}

/** "Carrier|Line" → ref; null for an empty / malformed key. */
export function parseLineKey(key: string): CarrierLineRef | null {
  const [carrier, ...rest] = key.split("|");
  if (!carrier?.trim()) return null;
  const lineName = rest.join("|").trim();
  return { carrier: carrier.trim(), lineName: lineName || null };
}

export function parseCarrierRules(raw: unknown): CarrierRules {
  if (!raw || typeof raw !== "object") return EMPTY_CARRIER_RULES;
  const row = raw as Record<string, unknown>;
  const blocked = Array.isArray(row.blocked)
    ? [...new Set(row.blocked.filter((item): item is string => typeof item === "string" && item.includes("|")))]
    : [];
  const forced: Record<string, CarrierLineRef> = {};
  if (row.forced && typeof row.forced === "object") {
    for (const [market, value] of Object.entries(row.forced as Record<string, unknown>)) {
      const ref = parseLineRef(value);
      const code = normalizeDestination(market, "");
      if (ref && code) forced[code] = ref;
    }
  }
  return { blocked, forced };
}

export function parseCarrierPreferences(quoteJson: unknown): CarrierPreferences {
  if (!quoteJson || typeof quoteJson !== "object") return {};
  const raw = (quoteJson as Record<string, unknown>)[CARRIER_PREF_KEY];
  if (!raw || typeof raw !== "object") return {};
  const result: CarrierPreferences = {};
  for (const [market, value] of Object.entries(raw as Record<string, unknown>)) {
    const ref = parseLineRef(value);
    const code = normalizeDestination(market, "");
    if (ref && code) result[code] = ref;
  }
  return result;
}

/** Allowed line keys of a grid = every line present in `cells` minus the blocked ones; null when nothing is blocked. */
export function allowedLinesFromRules(cells: Pick<RateCell, "carrier" | "lineName">[], rules: CarrierRules) {
  if (rules.blocked.length === 0) return null;
  const blocked = new Set(rules.blocked);
  const allowed = new Set<string>();
  for (const cell of cells) {
    const key = lineKey(cell.carrier, cell.lineName);
    if (!blocked.has(key)) allowed.add(key);
  }
  return allowed;
}

export type CarrierSelection = {
  /** Line the engine should prefer: the forced line, else the client's choice, else null (cheapest). */
  preference: CarrierLineRef | null;
  /** True when Voltship forces the line on this market (client cannot change it). */
  forced: boolean;
};

/** Effective preference for one market: a forced line beats the product preference; a blocked preference is ignored. */
export function resolveCarrierSelection(
  rules: CarrierRules,
  preferences: CarrierPreferences,
  market: string,
): CarrierSelection {
  const code = normalizeDestination(market);
  const forced = rules.forced[code];
  if (forced) return { preference: forced, forced: true };
  const own = preferences[code] ?? null;
  if (own && rules.blocked.includes(lineKey(own.carrier, own.lineName))) {
    return { preference: null, forced: false };
  }
  return { preference: own, forced: false };
}

/** Display label of a line: "YunExpress CHC" or just the carrier for legacy single-line grids. */
export function carrierLineLabel(ref: CarrierLineRef | null | undefined) {
  if (!ref) return "";
  return ref.lineName ? `${ref.carrier} ${ref.lineName}` : ref.carrier;
}
