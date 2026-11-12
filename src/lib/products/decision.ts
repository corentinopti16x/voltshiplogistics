/**
 * Decision aid for the sourcing team: is this product worth quoting at that cost?
 * Two questions the team keeps asking: « is the price right? » and « is it too heavy? ».
 *
 * - price : landed cost (COGS, 1 unit) as a share of the Shopify selling price.
 * - weight: shipping as a share of the landed cost.
 * Thresholds are deliberately simple and shown to the user next to the verdict.
 */
export const DECISION_THRESHOLDS = {
  /** COGS / selling price: up to 30 % is comfortable, above 40 % leaves the client no room. */
  costGood: 0.3,
  costLimit: 0.4,
  /** Shipping / COGS: above half, the parcel weight costs more than everything else. */
  weightHeavy: 0.5,
} as const;

export type DecisionLevel = "good" | "limit" | "bad";

export type SourcingDecision = {
  /** COGS as a share of the selling price (0.32 = 32 %); null without a selling price. */
  costShare: number | null;
  costLevel: DecisionLevel | null;
  /** What is left per unit after the landed cost, in the selling price's currency. */
  left: number | null;
  shippingShare: number | null;
  heavy: boolean;
};

export function sourcingDecision(input: {
  sellingPrice: number | null | undefined;
  cogs: number | null | undefined;
  shipping: number | null | undefined;
}): SourcingDecision {
  const cogs = Number(input.cogs);
  const hasCogs = Number.isFinite(cogs) && cogs > 0;
  const selling = Number(input.sellingPrice);
  const hasSelling = Number.isFinite(selling) && selling > 0;
  const shipping = Number(input.shipping);
  const costShare = hasCogs && hasSelling ? cogs / selling : null;
  const shippingShare =
    hasCogs && Number.isFinite(shipping) && shipping >= 0 ? shipping / cogs : null;
  return {
    costShare,
    costLevel:
      costShare == null
        ? null
        : costShare <= DECISION_THRESHOLDS.costGood
          ? "good"
          : costShare <= DECISION_THRESHOLDS.costLimit
            ? "limit"
            : "bad",
    left: costShare == null ? null : Math.round((selling - cogs) * 100) / 100,
    shippingShare,
    heavy: shippingShare != null && shippingShare > DECISION_THRESHOLDS.weightHeavy,
  };
}
