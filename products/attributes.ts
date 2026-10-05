import type { ShippingChannel } from "@/lib/domain/pricing";

/**
 * Concrete answers the client gives on the "Nouveau produit" form instead of
 * picking an abstract shipping channel. Stored raw in quote_json._request.attributes
 * so the sourcer can see what was ticked and confirm/correct the channel.
 */
export type ProductAttributes = {
  /** Battery / electronics (earbuds, smartwatch, LED lamp, vape). */
  electronics: boolean;
  /** Liquid / cream / perfume (serum, oil, scented candle, perfume). */
  liquid: boolean;
  /** Only meaningful when `liquid` is true: perfume or alcohol-based. */
  alcohol: boolean;
  /** Ingestible / supplement / food (gummies, protein, tea, snacks). */
  ingestible: boolean;
  /** Magnet inside (phone holder, magnetic closure). */
  magnetic: boolean;
};

export const EMPTY_ATTRIBUTES: ProductAttributes = {
  electronics: false,
  liquid: false,
  alcohol: false,
  ingestible: false,
  magnetic: false,
};

export const ATTRIBUTE_KEYS = ["electronics", "liquid", "ingestible", "magnetic"] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

const CHANNELS: ShippingChannel[] = [
  "standard",
  "electronics_battery",
  "cosmetics",
  "liquid_perfume",
  "magnetic",
  "sensitive_other",
];

export function isShippingChannel(value: unknown): value is ShippingChannel {
  return typeof value === "string" && (CHANNELS as string[]).includes(value);
}

/**
 * Channel suggested from the client's answers. Priority when several boxes are
 * ticked: electronics_battery > liquid_perfume > sensitive_other > cosmetics >
 * magnetic > standard (the most constraining line wins).
 */
export function deriveSuggestedChannel(attributes: Partial<ProductAttributes>): ShippingChannel {
  if (attributes.electronics) return "electronics_battery";
  if (attributes.liquid && attributes.alcohol) return "liquid_perfume";
  if (attributes.ingestible) return "sensitive_other";
  if (attributes.liquid) return "cosmetics";
  if (attributes.magnetic) return "magnetic";
  return "standard";
}

/** Normalises whatever is stored under `_request.attributes` (missing → all false). */
export function parseProductAttributes(raw: unknown): ProductAttributes {
  if (!raw || typeof raw !== "object") return { ...EMPTY_ATTRIBUTES };
  const row = raw as Record<string, unknown>;
  const liquid = row.liquid === true;
  return {
    electronics: row.electronics === true,
    liquid,
    // The alcohol sub-question only exists when the product is liquid.
    alcohol: liquid && row.alcohol === true,
    ingestible: row.ingestible === true,
    magnetic: row.magnetic === true,
  };
}

/** Keys of the attributes the client ticked (alcohol only alongside liquid). */
export function tickedAttributes(attributes: ProductAttributes): Array<AttributeKey | "alcohol"> {
  const keys: Array<AttributeKey | "alcohol"> = ATTRIBUTE_KEYS.filter((key) => attributes[key]);
  if (attributes.liquid && attributes.alcohol) keys.push("alcohol");
  return keys;
}

export type EstimateInput = {
  /** Client-declared approximate unit weight. */
  approx_weight_g?: number | null;
  /** What the client pays today per unit at their agent. */
  current_unit_cost?: number | null;
  /** Fallback product component when no current cost is given. */
  target_unit_price?: number | null;
  suggested_channel?: string | null;
};

export type EstimateBasis = {
  weightG: number;
  /** Product component used for the estimate. */
  unitCost: number;
  unitCostSource: "current_unit_cost" | "target_unit_price";
  channel: ShippingChannel;
};

function positive(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Gating of the early estimate: only when there is no real quote yet (sourcing
 * not done: weight/channel/price not set by Voltship) AND the client gave an
 * approximate weight plus a cost basis. Returns null when nothing should be shown.
 */
export function estimateBasis(
  request: EstimateInput,
  hasRealQuote: boolean,
): EstimateBasis | null {
  if (hasRealQuote) return null;
  const weightG = positive(request.approx_weight_g);
  if (weightG == null) return null;
  const current = positive(request.current_unit_cost);
  const target = current == null ? positive(request.target_unit_price) : null;
  const unitCost = current ?? target;
  if (unitCost == null) return null;
  return {
    weightG: Math.round(weightG),
    unitCost,
    unitCostSource: current != null ? "current_unit_cost" : "target_unit_price",
    channel: isShippingChannel(request.suggested_channel) ? request.suggested_channel : "standard",
  };
}
