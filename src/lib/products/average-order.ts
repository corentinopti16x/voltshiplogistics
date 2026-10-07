/**
 * COGS of an average order: the live grid gives the landed cost for 1, 2, 3, 4, 5 units in
 * one parcel; an average order of 1.4 units costs cogs(1) + 0.4 × (cogs(2) − cogs(1)).
 * Beyond the ladder, the last step's per-unit increment is extended.
 */
export function cogsForQuantity(
  ladder: Array<{ quantity: number; cogs: number | null }>,
  quantity: number | null,
): number | null {
  if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) return null;
  const steps = ladder
    .filter((step): step is { quantity: number; cogs: number } => step.cogs != null)
    .sort((a, b) => a.quantity - b.quantity);
  if (steps.length === 0) return null;
  if (steps.length === 1) return (steps[0].cogs / steps[0].quantity) * quantity;
  if (quantity <= steps[0].quantity) return steps[0].cogs * (quantity / steps[0].quantity);
  for (let i = 1; i < steps.length; i += 1) {
    const lo = steps[i - 1];
    const hi = steps[i];
    if (quantity <= hi.quantity) {
      const ratio = (quantity - lo.quantity) / (hi.quantity - lo.quantity);
      return lo.cogs + ratio * (hi.cogs - lo.cogs);
    }
  }
  const last = steps[steps.length - 1];
  const prev = steps[steps.length - 2];
  const perUnit = (last.cogs - prev.cogs) / (last.quantity - prev.quantity);
  return last.cogs + (quantity - last.quantity) * perUnit;
}
