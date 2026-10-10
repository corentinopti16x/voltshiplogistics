import "server-only";
import { resolveClientPricing } from "@/lib/domain/pricing-tiers";
import {
  activeAnnouncedPrices,
  announcedPriceFor,
  applyAnnouncedPrice,
  calculateCogs,
  hasInternalBattery,
  parseParcelDimensions,
  type CarrierLineRef,
  type ShippingChannel,
} from "@/lib/domain/pricing";
import {
  EMPTY_CARRIER_RULES,
  allowedLinesFromRules,
  parseCarrierPreferences,
  parseCarrierRules,
  resolveCarrierSelection,
  type CarrierRules,
} from "@/lib/domain/carrier-rules";
import { carrierModeOf, type CarrierMode } from "@/lib/pricing/matrix-view";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProductRow } from "@/lib/products/types";
import { getActiveGridVersion, getProductMarkets, loadRateCellsFor, type ClientPricingProfile } from "./server";
import { handlingLadderFrom, readPricingSettings } from "./settings";
import { parcelExtras } from "@/lib/products/extras";

export type CatalogMarketQuote = {
  destination: string;
  /** COGS for 1 unit sold (client view, same engine as the product page); null = no rate. */
  cogs: number | null;
  /** Line that ships 1 unit on this market (null when nothing matches). */
  line: CarrierLineRef | null;
  deliveryRange: string | null;
  mode: CarrierMode;
  /** Chosen / forced line cannot ship 1 unit: the cheapest line is used instead. */
  fallback: boolean;
  /** Total fixed by hand (« prix annoncé ») for 1 unit on this market. */
  announced: boolean;
};

export type CatalogQuote = {
  missing: "product_data" | "grid" | null;
  markets: CatalogMarketQuote[];
};

/**
 * COGS ×1 and carrier line per market for many products at once (catalogue page). Loads the
 * grid, the clients' paliers and carrier rules once, then runs the same `calculateCogs`
 * selection as `calculateProductCogsMatrix` (forced line → chosen line → cheapest allowed).
 */
export async function calculateCatalogQuotes(products: ProductRow[]): Promise<Map<string, CatalogQuote>> {
  const out = new Map<string, CatalogQuote>();
  const ready = products.filter(
    (product) => product.client_price != null && product.weight_g != null && !!product.shipping_channel,
  );
  for (const product of products) {
    if (!ready.includes(product)) {
      out.set(product.id, { missing: "product_data", markets: [] });
    }
  }
  if (ready.length === 0) return out;

  const admin = createAdminClient();
  const clientIds = [...new Set(ready.map((product) => product.client_id))];
  const [activeGridVersion, settings, clientsResult] = await Promise.all([
    getActiveGridVersion(),
    readPricingSettings(admin),
    admin
      .from("clients")
      .select("id, pricing_tier, commission_pct, handling_fee, logistics_discount_pct, carrier_rules_json")
      .in("id", clientIds),
  ]);
  if (!activeGridVersion) {
    for (const product of ready) out.set(product.id, { missing: "grid", markets: [] });
    return out;
  }
  const profiles = new Map<string, ClientPricingProfile>();
  const rules = new Map<string, CarrierRules>();
  for (const client of clientsResult.data ?? []) {
    profiles.set(client.id, resolveClientPricing(client));
    rules.set(client.id, parseCarrierRules(client.carrier_rules_json));
  }
  const marketsOf = new Map(ready.map((product) => [product.id, getProductMarkets(product)]));
  const destinations = [...new Set([...marketsOf.values()].flat())];
  const channels = [...new Set(ready.map((product) => product.shipping_channel as string))];
  const cells = await loadRateCellsFor(activeGridVersion, destinations, channels);

  for (const product of ready) {
    const clientRules = rules.get(product.client_id) ?? EMPTY_CARRIER_RULES;
    const profile = profiles.get(product.client_id) ?? resolveClientPricing(null);
    const preferences = parseCarrierPreferences(product.quote_json);
    const allowedLines = allowedLinesFromRules(cells, clientRules);
    const announcedPrices = activeAnnouncedPrices(product.quote_json);
    const markets = (marketsOf.get(product.id) ?? []).map((destination) => {
      const selection = resolveCarrierSelection(clientRules, preferences, destination);
      const computed = calculateCogs({
        clientPrice: Number(product.client_price),
        weightG: Number(product.weight_g),
        channel: product.shipping_channel as ShippingChannel,
        destination,
        cells,
        quantity: 1,
        dimensionsCm: parseParcelDimensions(product.quote_json),
        volumetricDivisors: settings.volumetric_divisors,
        carrierPreference: selection.preference,
        allowedLines,
        handlingLadder: handlingLadderFrom(settings),
        fxRmbPerEur: settings.fx_rmb_per_eur,
        batteryInternal: hasInternalBattery(product.quote_json),
        ...parcelExtras(product.quote_json, settings),
        ...profile,
      });
      const announced = announcedPriceFor(announcedPrices, destination, 1);
      const breakdown = computed && announced != null ? applyAnnouncedPrice(computed, announced) : computed;
      return {
        destination,
        cogs: breakdown?.cogs ?? null,
        line: breakdown ? { carrier: breakdown.carrier, lineName: breakdown.lineName } : null,
        deliveryRange: breakdown?.deliveryRange ?? null,
        mode: carrierModeOf(selection),
        fallback: breakdown?.selectionReason === "fallback_preferred_unavailable",
        announced: breakdown?.announced === true,
      } satisfies CatalogMarketQuote;
    });
    out.set(product.id, { missing: null, markets });
  }
  return out;
}
