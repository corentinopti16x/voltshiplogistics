import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_VOLUMETRIC_DIVISORS, type HandlingLadder, type VolumetricDivisors } from "../domain/pricing";

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
   * + handling_extra_unit_eur per unit above 3. Default 1,00 / 1,30 / 1,50 €.
   */
  handling_step2_eur: number;
  handling_step3_eur: number;
  handling_extra_unit_eur: number;
};

export const PRICING_SETTINGS_KEY = "pricing_settings";

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  fx_rmb_per_eur: 7.5,
  margin_pct: 12,
  min_margin_eur_per_parcel: 1.5,
  eu_parcel_tax_eur: 0,
  volumetric_divisors: { ...DEFAULT_VOLUMETRIC_DIVISORS },
  handling_cost_eur: 0,
  fx_market_rate: 7.8,
  handling_step2_eur: 0.3,
  handling_step3_eur: 0.5,
  handling_extra_unit_eur: 0,
};

export type NumericPricingSetting = Exclude<keyof PricingSettings, "volumetric_divisors">;

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
