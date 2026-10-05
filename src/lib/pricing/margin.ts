/**
 * Voltship margin — CONFIDENTIAL, internal to Voltship (role `voltship_admin` only).
 *
 * Pure computation shared by the admin margin pages. The "client side" of every
 * figure is the exact client-facing engine (`calculateCogs` in `@/lib/domain/pricing`):
 * this module only adds what the client never sees — the factory purchase price, the
 * raw carrier cost and the internal handling cost — and derives the margin split.
 *
 * Never import this from a client component or a client-facing route: the loaders in
 * `./margin-server` enforce the admin role, the types here carry internal costs.
 *
 *   client pays   = product (clientPrice × n) + commission + shipping (grid − discount) + handling
 *   Voltship cost = factory (RMB / fx) + carrier (RMB / fx) + EU tax pass-through + handling cost
 *   margin        = sourcing (product + commission − factory)
 *                 + transport (shipping − carrier − tax pass-through)
 *                 + handling (handling fee − handling cost)
 *   FX margin     = RMB costs / fx_billing − RMB costs / fx_market   (shown separately, estimated)
 */

import type { CogsBreakdown } from "../domain/pricing";
import type { PricingSettings } from "./settings";

export type MarginFlag =
  /** sourcing_work.factory_purchase_price missing → sourcing margin unknown. */
  | "factory_price_missing"
  /** Rate cell has no carrier_cost_rmb (grid imported before the assistant) → transport margin unknown. */
  | "carrier_cost_unknown"
  /** Carrier cost taken from the ECCANG fee details of a shipped order (real). */
  | "carrier_cost_real"
  /** Carrier cost estimated from the grid cell at the (billed or computed) weight. */
  | "carrier_cost_estimated"
  /** No rate cell matches the parcel weight: nothing can be computed. */
  | "no_rate";

export type MarginSettings = Pick<
  PricingSettings,
  "fx_rmb_per_eur" | "eu_parcel_tax_eur" | "handling_cost_eur" | "fx_market_rate"
>;

export type VoltshipMarginInput = {
  /** Units in the parcel. */
  quantity: number;
  /** Client-facing breakdown for this parcel (from `calculateCogs`), null when no rate matched. */
  client: Pick<CogsBreakdown, "product" | "commission" | "shipping" | "handling"> | null;
  /** Factory purchase price for the WHOLE parcel in RMB (unit price × n); null when unknown. */
  factoryCostRmb: number | null;
  /** Carrier cost for the parcel in RMB; null when unknown. */
  carrierCostRmb: number | null;
  /** Where the carrier cost comes from: the grid cell (estimated) or the ECCANG fee (real). */
  carrierCostSource: "grid" | "real" | null;
  /** Rate-cell flag: false when the EU parcel tax was added on top of the carrier price. */
  taxIncluded: boolean;
  settings: MarginSettings;
};

export type VoltshipMargin = {
  quantity: number;
  /** What the client is billed for this parcel (EUR). */
  clientPays: {
    product: number;
    commission: number;
    shipping: number;
    handling: number;
    total: number;
  };
  /** What it costs Voltship (EUR). `total` sums the known components only. */
  costs: {
    factory: number | null;
    carrier: number | null;
    /** EU parcel tax collected and paid on — neither margin nor cost in the split. */
    taxPassThrough: number;
    handling: number;
    total: number;
  };
  margin: {
    sourcing: number | null;
    transport: number | null;
    handling: number;
    /** Sum of the KNOWN components; see `complete`. */
    total: number;
    /** total / clientPays.total, null when the client pays nothing. */
    pct: number | null;
    perUnit: number;
  };
  /** Estimated gain from billing RMB costs at fx_rmb_per_eur instead of fx_market_rate. */
  fx: {
    billingRate: number;
    marketRate: number;
    rmbCosts: number | null;
    gainEur: number | null;
  };
  carrierCostSource: "grid" | "real" | null;
  /** False when a cost component is unknown (see flags) — the margin is then a partial figure. */
  complete: boolean;
  flags: MarginFlag[];
};

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function finiteOrNull(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : null;
}

export function rmbToEur(rmb: number | null | undefined, fx: number) {
  const value = finiteOrNull(rmb);
  if (value == null || !Number.isFinite(fx) || fx <= 0) return null;
  return money(value / fx);
}

/** Margin split for one parcel. Pure. */
export function computeVoltshipMargin(input: VoltshipMarginInput): VoltshipMargin {
  const { settings } = input;
  const quantity = Math.max(1, Math.round(input.quantity));
  const flags: MarginFlag[] = [];
  const fx = settings.fx_rmb_per_eur;

  const client = {
    product: money(input.client?.product ?? 0),
    commission: money(input.client?.commission ?? 0),
    shipping: money(input.client?.shipping ?? 0),
    handling: money(input.client?.handling ?? 0),
    total: 0,
  };
  client.total = money(client.product + client.commission + client.shipping + client.handling);
  if (!input.client) flags.push("no_rate");

  const factoryRmb = finiteOrNull(input.factoryCostRmb);
  const carrierRmb = finiteOrNull(input.carrierCostRmb);
  const factory = rmbToEur(factoryRmb, fx);
  const carrier = rmbToEur(carrierRmb, fx);
  if (factory == null) flags.push("factory_price_missing");
  if (carrier == null) {
    flags.push("carrier_cost_unknown");
  } else if (input.carrierCostSource === "real") {
    flags.push("carrier_cost_real");
  } else {
    flags.push("carrier_cost_estimated");
  }

  const taxPassThrough = input.client && !input.taxIncluded ? money(settings.eu_parcel_tax_eur) : 0;
  const handlingCost = money(Math.max(0, settings.handling_cost_eur));
  const costs = {
    factory,
    carrier,
    taxPassThrough,
    handling: handlingCost,
    total: money((factory ?? 0) + (carrier ?? 0) + taxPassThrough + handlingCost),
  };

  const sourcing = factory == null ? null : money(client.product + client.commission - factory);
  const transport =
    carrier == null || !input.client ? null : money(client.shipping - carrier - taxPassThrough);
  const handling = money(client.handling - handlingCost);
  const total = money((sourcing ?? 0) + (transport ?? 0) + handling);

  const rmbCosts = factoryRmb == null && carrierRmb == null ? null : (factoryRmb ?? 0) + (carrierRmb ?? 0);
  const marketRate = settings.fx_market_rate;
  const gainEur =
    rmbCosts == null || !Number.isFinite(marketRate) || marketRate <= 0 || fx <= 0
      ? null
      : money(rmbCosts / fx - rmbCosts / marketRate);

  return {
    quantity,
    clientPays: client,
    costs,
    margin: {
      sourcing,
      transport,
      handling,
      total,
      pct: client.total > 0 ? money(total / client.total) : null,
      perUnit: money(total / quantity),
    },
    fx: { billingRate: fx, marketRate, rmbCosts, gainEur },
    carrierCostSource: carrier == null ? null : input.carrierCostSource,
    complete: Boolean(input.client) && factory != null && carrier != null,
    flags,
  };
}

export type MarginTotals = {
  /** Sum of the weights (units or parcels) behind the totals. */
  weight: number;
  revenue: number;
  cost: number;
  margin: number;
  sourcing: number;
  transport: number;
  handling: number;
  fxGain: number;
  pct: number | null;
  /** Items (weight-adjusted) whose margin is complete / real / estimated. */
  complete: number;
  incomplete: number;
  real: number;
  estimated: number;
};

/** Weighted sum of parcel margins (weight = units sold, parcels shipped… default 1). */
export function sumMargins(items: Array<{ margin: VoltshipMargin; weight?: number }>): MarginTotals {
  const totals: MarginTotals = {
    weight: 0,
    revenue: 0,
    cost: 0,
    margin: 0,
    sourcing: 0,
    transport: 0,
    handling: 0,
    fxGain: 0,
    pct: null,
    complete: 0,
    incomplete: 0,
    real: 0,
    estimated: 0,
  };
  for (const item of items) {
    const w = item.weight ?? 1;
    if (!Number.isFinite(w) || w <= 0) continue;
    const m = item.margin;
    totals.weight += w;
    totals.revenue += m.clientPays.total * w;
    totals.cost += m.costs.total * w;
    totals.margin += m.margin.total * w;
    totals.sourcing += (m.margin.sourcing ?? 0) * w;
    totals.transport += (m.margin.transport ?? 0) * w;
    totals.handling += m.margin.handling * w;
    totals.fxGain += (m.fx.gainEur ?? 0) * w;
    if (m.complete) totals.complete += w;
    else totals.incomplete += w;
    if (m.carrierCostSource === "real") totals.real += w;
    else if (m.carrierCostSource === "grid") totals.estimated += w;
  }
  for (const key of ["revenue", "cost", "margin", "sourcing", "transport", "handling", "fxGain"] as const) {
    totals[key] = money(totals[key]);
  }
  totals.pct = totals.revenue > 0 ? money(totals.margin / totals.revenue) : null;
  return totals;
}

/**
 * Real carrier cost (RMB) from an ECCANG `fee_json` ({ details, items }) when the fee
 * details carry a shipping/freight/postage line. Null otherwise (→ estimated from the grid).
 */
export function extractCarrierCostRmb(feeJson: unknown): number | null {
  if (!feeJson || typeof feeJson !== "object") return null;
  const fee = feeJson as { details?: unknown; items?: unknown };
  const isShipping = (code: string) => /ship|freight|postage|carrier|运费|邮费/i.test(code);

  if (Array.isArray(fee.items)) {
    let sum = 0;
    let found = false;
    for (const item of fee.items) {
      if (!item || typeof item !== "object") continue;
      const row = item as { ft_code?: unknown; amount?: unknown };
      if (typeof row.ft_code !== "string" || !isShipping(row.ft_code)) continue;
      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) continue;
      sum += amount;
      found = true;
    }
    if (found) return money(sum);
  }

  if (fee.details && typeof fee.details === "object") {
    let sum = 0;
    let found = false;
    for (const [key, raw] of Object.entries(fee.details as Record<string, unknown>)) {
      if (!isShipping(key)) continue;
      const amount = Number(raw);
      if (!Number.isFinite(amount)) continue;
      sum += amount;
      found = true;
    }
    if (found) return money(sum);
  }
  return null;
}
