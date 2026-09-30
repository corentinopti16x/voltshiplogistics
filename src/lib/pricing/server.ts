import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  calculateCogs,
  normalizeDestination,
  type CogsBreakdown,
  type RateCell,
  type ShippingChannel,
} from "@/lib/domain/pricing";
import type { ProductRow } from "@/lib/products/types";

export type ClientPricingProfile = {
  commissionPct: number;
  handlingFee: number;
  logisticsDiscountPct: number;
};

export type LiveProductQuote = {
  breakdown: CogsBreakdown | null;
  activeGridVersion: string | null;
  destination: string;
  missingReason: "product_data" | "grid" | "rate" | null;
};

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getDestination(product: ProductRow) {
  const quoteDestination = product.quote_json?.destination;
  if (typeof quoteDestination === "string" && quoteDestination.trim()) {
    return normalizeDestination(quoteDestination);
  }
  const request = product.quote_json?._request;
  if (request && typeof request === "object") {
    const raw = (request as Record<string, unknown>).destination_markets;
    if (typeof raw === "string" && raw.trim()) {
      return normalizeDestination(raw);
    }
  }
  return "FR";
}

export async function getActiveGridVersion() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("pricing_meta")
    .select("value")
    .eq("key", "active_grid_version")
    .maybeSingle();
  const version = data?.value;
  return version && version !== "uninitialized" ? version : null;
}

export async function getClientPricingProfile(clientId: string): Promise<ClientPricingProfile> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("clients")
    .select("commission_pct, handling_fee, logistics_discount_pct")
    .eq("id", clientId)
    .maybeSingle();
  return {
    commissionPct: numberOrZero(data?.commission_pct),
    handlingFee: numberOrZero(data?.handling_fee),
    logisticsDiscountPct: numberOrZero(data?.logistics_discount_pct),
  };
}

export async function calculateLiveProductQuote(
  product: ProductRow,
): Promise<LiveProductQuote> {
  const destination = getDestination(product);
  if (
    product.client_price == null ||
    product.weight_g == null ||
    !product.shipping_channel
  ) {
    return {
      breakdown: null,
      activeGridVersion: null,
      destination,
      missingReason: "product_data",
    };
  }

  const admin = createAdminClient();
  const [activeGridVersion, profile] = await Promise.all([
    getActiveGridVersion(),
    getClientPricingProfile(product.client_id),
  ]);
  if (!activeGridVersion) {
    return { breakdown: null, activeGridVersion: null, destination, missingReason: "grid" };
  }

  const { data } = await admin
    .from("rate_grid_cells")
    .select(
      "grid_version, carrier, destination, channel, weight_min_g, weight_max_g, price, delivery_range",
    )
    .eq("grid_version", activeGridVersion)
    .eq("destination", destination)
    .eq("channel", product.shipping_channel)
    .lte("weight_min_g", product.weight_g)
    .gte("weight_max_g", product.weight_g);

  const cells: RateCell[] = (data ?? []).map((cell) => ({
    gridVersion: cell.grid_version,
    carrier: cell.carrier,
    destination: cell.destination,
    channel: cell.channel as ShippingChannel,
    weightMinG: Number(cell.weight_min_g),
    weightMaxG: Number(cell.weight_max_g),
    price: Number(cell.price),
    deliveryRange: cell.delivery_range,
  }));
  const breakdown = calculateCogs({
    clientPrice: Number(product.client_price),
    weightG: product.weight_g,
    channel: product.shipping_channel as ShippingChannel,
    destination,
    cells,
    ...profile,
  });

  return {
    breakdown,
    activeGridVersion,
    destination,
    missingReason: breakdown ? null : "rate",
  };
}
