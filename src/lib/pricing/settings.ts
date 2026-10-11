import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_PACKAGING_LADDER,
  DEFAULT_VOLUMETRIC_DIVISORS,
  type HandlingLadder,
  type PackagingStep,
  type VolumetricDivisors,
} from "../domain/pricing";

/**
 * Voltship margin rule used to turn a carrier cost (RMB) into the grid price (EUR).
 * Stored as JSON in pricing_meta (key `pricing_settings`), editable by admins.
 *
 *   cost_eur = carrier_cost_rmb / fx_rmb_per_eur
 *   price    = round_0.05( cost_eur
 *                        + max(cost_eur × margin_pct / 100, min_margin_eur_per_parcel)
 *                        + (tax_included ? 0 : eu_parcel_tax_eur) )
 *
 * Grid prices are all-inclusive (the Voltship matrix is "TOUT COMPRIS"): eu_parcel_tax_eur
 * is a manual per-parcel supplement for assistant imports only, normally 0.
 */
export type PricingSettings = {
  fx_rmb_per_eur: number;
  margin_pct: number;
  min_margin_eur_per_parcel: number;
  /** Manual per-parcel supplement for non-inclusive assistant lines — normally 0. */
  eu_parcel_tax_eur: number;
  /** Volumetric divisor per carrier (cm³ → kg), `default` for the others. */
  volumetric_divisors: VolumetricDivisors;
  /** Real internal handling cost per order (EUR) — Voltship margin view only. */
  handling_cost_eur: number;
  /** Market RMB/EUR rate used to estimate the FX gain vs the billing rate — internal. */
  fx_market_rate: number;
  /**
   * Handling grows with the parcel: client handling fee (1 € by default) for 1 unit,
   * + handling_step2_eur for 2 units, + handling_step3_eur for 3 units, then
   * + handling_extra_unit_eur per unit above 3. Default +0,15 € per extra unit, same for
   * every palier: 1,00 / 1,15 / 1,30 / 1,45 / 1,60 €.
   */
  handling_step2_eur: number;
  handling_step3_eur: number;
  handling_extra_unit_eur: number;
  /** Alert (admin Marge) when a locked « prix annoncé » leaves less margin per parcel than this. */
  announced_margin_alert_eur: number;
  /**
   * Packaging (bag / carton, filler, label) added to every parcel's weight, by the weight of
   * its contents: 20 g for a small parcel, more for bigger ones. Last step = no upper limit.
   */
  packaging_ladder: PackagingStep[];
  /**
   * Carriers allowed for the AUTOMATIC (cheapest) choice per market, e.g. US → YunExpress and
   * Tongyou while Huahan only covers part of the US postcodes. Other carriers stay
   * selectable by hand and are shown as the "postcode covered" price. Empty = all carriers.
   */
  auto_carriers: Record<string, string[]>;
};

export const DEFAULT_AUTO_CARRIERS: Record<string, string[]> = { US: ["YunExpress", "Tongyou"] };

export const PRICING_SETTINGS_KEY = "pricing_settings";

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  fx_rmb_per_eur: 7.5,
  margin_pct: 12,
  min_margin_eur_per_parcel: 1.5,
  eu_parcel_tax_eur: 0,
  volumetric_divisors: { ...DEFAULT_VOLUMETRIC_DIVISORS },
  handling_cost_eur: 0,
  fx_market_rate: 7.8,
  handling_step2_eur: 0.15,
  handling_step3_eur: 0.3,
  handling_extra_unit_eur: 0.15,
  announced_margin_alert_eur: 0.5,
  packaging_ladder: DEFAULT_PACKAGING_LADDER,
  auto_carriers: DEFAULT_AUTO_CARRIERS,
};

export type NumericPricingSetting = Exclude<
  keyof PricingSettings,
  "volumetric_divisors" | "auto_carriers" | "packaging_ladder"
>;

const BOUNDS: Record<NumericPricingSetting, [number, number]> = {
  fx_rmb_per_eur: [0.5, 100],
  margin_pct: [0, 500],
  min_margin_eur_per_parcel: [0, 100],
  eu_parcel_tax_eur: [0, 100],
  handling_cost_eur: [0, 100],
  fx_market_rate: [0.5, 100],
  handling_step2_eur: [0, 50],
  handling_step3_eur: [0, 50],
  handling_extra_unit_eur: [0, 50],
  announced_margin_alert_eur: [0, 50],
};

/** Merge a partial / unknown payload over the defaults, clamping to sane bounds. */
export function parsePricingSettings(raw: unknown): PricingSettings {
  const source =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : typeof raw === "string"
        ? safeJson(raw)
        : {};
  const out: PricingSettings = { ...DEFAULT_PRICING_SETTINGS, volumetric_divisors: { ...DEFAULT_VOLUMETRIC_DIVISORS } };
  for (const key of Object.keys(BOUNDS) as NumericPricingSetting[]) {
    const value = Number(source[key]);
    if (!Number.isFinite(value)) continue;
    const [min, max] = BOUNDS[key];
    out[key] = Math.min(max, Math.max(min, value));
  }
  out.volumetric_divisors = parseVolumetricDivisors(source.volumetric_divisors);
  out.auto_carriers = parseAutoCarriers(source.auto_carriers);
  out.packaging_ladder = parsePackagingLadder(source.packaging_ladder);
  return out;
}

/**
 * Packaging steps sorted by limit, last step open-ended; invalid → defaults. Weights 0–2 000 g.
 */
export function parsePackagingLadder(raw: unknown): PackagingStep[] {
  const source = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  if (!Array.isArray(source)) return DEFAULT_PACKAGING_LADDER.map((step) => ({ ...step }));
  const steps: PackagingStep[] = [];
  for (const entry of source) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const weight = Number(record.weightG ?? record.weight_g);
    const limitRaw = record.upToG ?? record.up_to_g;
    const limit = limitRaw == null || limitRaw === "" ? null : Number(limitRaw);
    if (!Number.isFinite(weight) || weight < 0 || weight > 2000) continue;
    if (limit != null && (!Number.isFinite(limit) || limit <= 0)) continue;
    steps.push({ upToG: limit == null ? null : Math.round(limit), weightG: Math.round(weight) });
  }
  if (steps.length === 0) return DEFAULT_PACKAGING_LADDER.map((step) => ({ ...step }));
  const bounded = steps.filter((step) => step.upToG != null).sort((a, b) => (a.upToG as number) - (b.upToG as number));
  const open = steps.find((step) => step.upToG == null) ?? { upToG: null, weightG: bounded[bounded.length - 1]?.weightG ?? 0 };
  return [...bounded, open];
}

/** `{ "US": ["YunExpress", "Tongyou"] }`; missing → defaults, `{}` → no restriction anywhere. */
export function parseAutoCarriers(raw: unknown): Record<string, string[]> {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : typeof raw === "string" ? safeJson(raw) : null;
  if (!source) return { ...DEFAULT_AUTO_CARRIERS };
  const out: Record<string, string[]> = {};
  for (const [market, carriers] of Object.entries(source)) {
    if (!/^[A-Z]{2}$/i.test(market) || !Array.isArray(carriers)) continue;
    const list = carriers.filter((c): c is string => typeof c === "string" && /^[\w .-]{1,40}$/.test(c.trim())).map((c) => c.trim());
    if (list.length > 0) out[market.toUpperCase()] = list;
  }
  return out;
}

/** `{ "Huahan": 6000, "default": 8000 }` merged over the defaults, 1 000–50 000 only. */
export function parseVolumetricDivisors(raw: unknown): VolumetricDivisors {
  const out: VolumetricDivisors = { ...DEFAULT_VOLUMETRIC_DIVISORS };
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : typeof raw === "string" ? safeJson(raw) : {};
  for (const [carrier, value] of Object.entries(source)) {
    const divisor = Number(value);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(carrier) || !Number.isFinite(divisor)) continue;
    out[carrier] = Math.min(50_000, Math.max(1_000, Math.round(divisor)));
  }
  return out;
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function readPricingSettings(admin: SupabaseClient): Promise<PricingSettings> {
  const { data } = await admin
    .from("pricing_meta")
    .select("value")
    .eq("key", PRICING_SETTINGS_KEY)
    .maybeSingle();
  return parsePricingSettings(data?.value ?? null);
}

export async function writePricingSettings(
  admin: SupabaseClient,
  settings: PricingSettings,
): Promise<{ error: string | null }> {
  const clean = parsePricingSettings(settings);
  const { error } = await admin
    .from("pricing_meta")
    .upsert({ key: PRICING_SETTINGS_KEY, value: JSON.stringify(clean) });
  return { error: error?.message ?? null };
}

/** Handling ladder of the settings (extra handling for 2, 3, 4+ units). */
export function handlingLadderFrom(settings: PricingSettings): HandlingLadder {
  return {
    step2: settings.handling_step2_eur,
    step3: settings.handling_step3_eur,
    extraUnit: settings.handling_extra_unit_eur,
  };
}
