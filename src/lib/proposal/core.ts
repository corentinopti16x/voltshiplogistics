import type { ShippingChannel } from "../domain/pricing";
import { TRANSPORT_CHANNELS } from "../pricing/transport-view";

/** Parcel sizes shown on a proposal: 1 to 5 units per order. */
export const PROPOSAL_QUANTITIES = [1, 2, 3, 4, 5] as const;
export const PROPOSAL_MAX_ITEMS = 12;
export const PROPOSAL_MAX_MARKETS = 6;

/** One product line as typed on the proposal form. */
export type ProposalItemInput = {
  name: string;
  /** Factory price per unit, in `currency`. */
  price: string;
  currency: "rmb" | "eur";
  weightG: string;
  channel: string;
};

export type ProposalItem = {
  name: string;
  priceEur: number;
  weightG: number;
  channel: ShippingChannel;
};

function positive(raw: string): number | null {
  const value = Number(String(raw ?? "").trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** A usable product line, or null when the name, price, weight or type is missing. */
export function cleanProposalItem(input: ProposalItemInput, fxRmbPerEur: number): ProposalItem | null {
  const name = String(input.name ?? "").trim().slice(0, 120);
  const price = positive(input.price);
  const weightG = positive(input.weightG);
  const channel = (TRANSPORT_CHANNELS as readonly string[]).includes(input.channel)
    ? (input.channel as ShippingChannel)
    : null;
  if (!name || price == null || weightG == null || !channel) return null;
  if (input.currency === "rmb" && !(fxRmbPerEur > 0)) return null;
  const priceEur = input.currency === "rmb" ? Math.round((price / fxRmbPerEur) * 100) / 100 : price;
  return { name, priceEur, weightG: Math.round(weightG), channel };
}

/** Country codes kept for a proposal: upper case, known by the active grid, no duplicate. */
export function cleanProposalMarkets(raw: readonly string[], known: readonly string[]): string[] {
  const allowed = new Set(known.map((code) => code.toUpperCase()));
  const kept: string[] = [];
  for (const entry of raw) {
    const code = String(entry ?? "").trim().toUpperCase();
    if (code && allowed.has(code) && !kept.includes(code)) kept.push(code);
  }
  return kept.slice(0, PROPOSAL_MAX_MARKETS);
}
