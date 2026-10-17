/**
 * Pure helpers linking ECCANG orders to the line routing (`@/lib/domain/line-routing`):
 * which grid line an ECCANG shipping method is (and back), what a parcel weighs and on
 * which channel it ships.
 */

import { parseLineKey } from "../domain/carrier-rules";
import {
  gridChannel,
  packagingWeightFor,
  parcelChannel,
  type CarrierLineRef,
  type PackagingStep,
  type ParcelDimensionsCm,
  type ShippingChannel,
} from "../domain/pricing";
import { billedWeightG, eccangOrderItems, shippingMethodKey, type ShippingMethodMap } from "./mapping";

/**
 * ECCANG shipping method code → the grid line it ships (reverse of the method map
 * "Carrier|Line" → code). Carrier-only keys give the carrier without line; the
 * `default` / `default:XX` fallbacks are not lines. Null when the code is not mapped.
 */
export function lineForShippingMethod(map: ShippingMethodMap, code: string | null | undefined): CarrierLineRef | null {
  const wanted = (code ?? "").trim().toLowerCase();
  if (!wanted) return null;
  let carrierOnly: CarrierLineRef | null = null;
  for (const [key, value] of Object.entries(map)) {
    if (value.trim().toLowerCase() !== wanted || key.toLowerCase().startsWith("default")) continue;
    const ref = parseLineKey(key);
    if (!ref) continue;
    if (ref.lineName) return ref;
    carrierOnly ??= ref;
  }
  return carrierOnly;
}

/**
 * ECCANG method of exactly this line ("Carrier|Line" key, or the carrier key for a line-less
 * grid). No carrier-only / default fallback: a planned 商派 parcel must never be sent with
 * the carrier's default method (which may be another, dearer line).
 */
export function exactShippingMethod(map: ShippingMethodMap, line: CarrierLineRef | null | undefined): string | null {
  if (!line) return null;
  const wanted = shippingMethodKey(line.carrier, line.lineName).toLowerCase();
  for (const [key, value] of Object.entries(map)) if (key.trim().toLowerCase() === wanted) return value;
  return null;
}

export type OrderParcelFacts = {
  country: string | null;
  zip: string | null;
  /** ECCANG order_weight (g): weighed weight once packed, else ECCANG's estimate. */
  billedWeightG: number | null;
  items: Array<{ sku: string; quantity: number }>;
  shippingMethod: string | null;
};

type Json = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

/**
 * Country, postcode, weight, lines and shipping method of an `eccang_orders` row: from the
 * ECCANG record kept in `last_payload` (getOrderList / getOrderByRefCode), or from the
 * Shopify order kept on a row that was never accepted by ECCANG.
 */
export function parcelFactsFromRow(row: {
  last_payload: unknown;
  shipping_method?: string | null;
  billed_weight_g?: number | null;
  items_json?: unknown;
}): OrderParcelFacts {
  const payload = (row.last_payload && typeof row.last_payload === "object" ? row.last_payload : {}) as Json;
  const shopify = (payload.shopify_order && typeof payload.shopify_order === "object" ? payload.shopify_order : null) as Json | null;
  let country = text(payload.consignee_country_code) || text(payload.country_code);
  let zip = text(payload.consigne_zipcode) || text(payload.consignee_zipcode) || text(payload.zipcode);
  let items = eccangOrderItems(payload);
  if (shopify) {
    const address = (shopify.shipping_address ?? {}) as Json;
    country ||= text(address.country_code);
    zip ||= text(address.zip);
    if (items.length === 0 && Array.isArray(shopify.line_items)) {
      items = (shopify.line_items as Json[])
        .filter((line) => text(line.sku) && line.requires_shipping !== false)
        .map((line) => ({ sku: text(line.sku), quantity: Math.max(1, Number(line.quantity) || 1) }));
    }
  }
  if (items.length === 0 && Array.isArray(row.items_json)) {
    items = (row.items_json as Json[])
      .filter((line) => text(line.sku))
      .map((line) => ({ sku: text(line.sku), quantity: Math.max(1, Number(line.quantity) || 1) }));
  }
  const weight = row.billed_weight_g ?? billedWeightG(payload.order_weight);
  return {
    country: country ? country.toUpperCase() : null,
    zip: zip || null,
    billedWeightG: weight && weight > 0 ? weight : null,
    items,
    shippingMethod: (row.shipping_method ?? text(payload.shipping_method)) || null,
  };
}

/** What the routing needs of a product, per warehouse SKU. */
export type ParcelProduct = {
  /** Weight of one unit SOLD (a set of `pieces` pieces), grams. */
  weightG: number | null;
  /** Pieces per unit sold (ECCANG lines count pieces). */
  pieces: number;
  channel: ShippingChannel | string | null;
  batteryInternal: boolean;
  /** Box bought for the product, grams per unit sold. */
  boxWeightG: number;
  /** Packaging fixed for this product (grams), null = ladder. */
  packagingWeightG: number | null;
  /** Unit dimensions (cm, per unit sold) for the volumetric weight; null = unknown. */
  dimensionsCm?: ParcelDimensionsCm | null;
  /** Client's own line per market (`_carrier_pref`). */
  carrierPrefs?: Record<string, CarrierLineRef>;
};

export type ParcelEstimate = {
  weightG: number;
  channel: ShippingChannel | null;
  /** Every battery item of the parcel has its battery built in (Huahan 内电 allowed). */
  batteryInternal: boolean;
  /** SKUs without product data (weight unknown): the estimate is a lower bound. */
  missing: string[];
  /** SKU of the item that sets the parcel's line (most constraining channel, first such item). */
  lead: string | null;
  /** Single-product parcel: units sold of that product (for its volumetric weight). */
  singleUnits: number | null;
};

function productOf(products: ReadonlyMap<string, ParcelProduct>, sku: string) {
  return products.get(sku) ?? products.get(sku.toUpperCase()) ?? null;
}

/**
 * Weight and channel of a parcel from its warehouse lines (pieces): contents + box per
 * piece, packaging once (as `calculateCogs` / `calculateBundleCogs` count it).
 */
export function parcelFromItems(
  items: Array<{ sku: string; quantity: number }>,
  products: ReadonlyMap<string, ParcelProduct>,
  ladder: PackagingStep[] | null | undefined,
): ParcelEstimate {
  let contentG = 0;
  let fixedPackaging: number | null = null;
  const channels: Array<string | null> = [];
  const missing: string[] = [];
  let batteryItems = 0;
  let internalBatteryItems = 0;
  for (const item of items) {
    const product = productOf(products, item.sku);
    if (!product || !(Number(product.weightG) > 0)) {
      missing.push(item.sku);
      if (product) channels.push(product.channel);
      continue;
    }
    const pieces = Math.max(1, product.pieces || 1);
    contentG += ((Number(product.weightG) + Math.max(0, product.boxWeightG || 0)) / pieces) * item.quantity;
    channels.push(product.channel);
    if (product.packagingWeightG != null) fixedPackaging = Math.max(fixedPackaging ?? 0, product.packagingWeightG);
    if (product.channel === "electronics_battery") {
      batteryItems += 1;
      if (product.batteryInternal) internalBatteryItems += 1;
    }
  }
  // Same rule as the COGS engine: one product → its own packaging when set; several
  // products (upsells) → the ladder, never below the largest product packaging.
  const skus = new Set(items.map((item) => item.sku));
  const ladderG = packagingWeightFor(contentG, ladder);
  const packaging = fixedPackaging == null ? ladderG : skus.size === 1 ? fixedPackaging : Math.max(fixedPackaging, ladderG);
  const channel = parcelChannel(channels.length ? channels : ["standard"]);
  const lead =
    items.find((item) => gridChannel(productOf(products, item.sku)?.channel ?? "standard") === channel)?.sku ?? items[0]?.sku ?? null;
  const single = skus.size === 1 ? productOf(products, items[0].sku) : null;
  const singlePieces = items.reduce((sum, item) => sum + item.quantity, 0);
  return {
    weightG: Math.round(contentG + (contentG > 0 ? packaging : 0)),
    channel,
    batteryInternal: batteryItems > 0 && batteryItems === internalBatteryItems,
    missing,
    lead,
    singleUnits: single ? Math.max(1, Math.ceil(singlePieces / Math.max(1, single.pieces || 1))) : null,
  };
}
