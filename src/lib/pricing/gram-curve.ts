/**
 * Compact gram-by-gram carrier cost curve of a grid line (Voltship matrix: one cost per
 * gram from 1 g). Stored on the parsed line as text so an import stays small (~5 KB per
 * line instead of ~100 KB of JSON numbers):
 *
 *   values in RMB cents, first value absolute then deltas, base 36, "_" = not offered,
 *   runs of the same token written "token*count" (count in base 36), comma separated.
 */

function toBase36(value: number) {
  return value < 0 ? `-${(-value).toString(36)}` : value.toString(36);
}

/** Costs (RMB) for grams 1..n, null = not offered → encoded curve. */
export function encodeGramCurve(costs: Array<number | null>): string {
  const tokens: string[] = [];
  let previous: number | null = null;
  for (const cost of costs) {
    if (cost == null || !Number.isFinite(cost)) {
      tokens.push("_");
      previous = null;
      continue;
    }
    const cents = Math.round(cost * 100);
    tokens.push(toBase36(previous == null ? cents : cents - previous));
    previous = cents;
  }
  const out: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    let j = i;
    while (j < tokens.length && tokens[j] === tokens[i]) j += 1;
    out.push(j - i === 1 ? tokens[i] : `${tokens[i]}*${(j - i).toString(36)}`);
    i = j;
  }
  return out.join(",");
}

/** Encoded curve → costs (RMB) for grams 1..n (index 0 = 1 g), null = not offered. */
export function decodeGramCurve(curve: string | null | undefined): Array<number | null> {
  if (!curve) return [];
  const out: Array<number | null> = [];
  let previous: number | null = null;
  for (const part of curve.split(",")) {
    const [token, countText] = part.split("*");
    const count = countText ? parseInt(countText, 36) : 1;
    for (let k = 0; k < count; k += 1) {
      if (token === "_") {
        out.push(null);
        previous = null;
        continue;
      }
      const value = parseInt(token, 36);
      const cents: number = previous == null ? value : previous + value;
      out.push(cents / 100);
      previous = cents;
    }
  }
  return out;
}

/**
 * Cost of every gram of [minG, maxG] from a decoded curve. A gram without its own price
 * takes the next heavier offered gram (never under-billed); `fallback` when none.
 */
export function gramCostsForBracket(
  costs: Array<number | null>,
  minG: number,
  maxG: number,
  fallback: number,
): number[] {
  const out: number[] = [];
  for (let g = minG; g <= maxG; g += 1) {
    let value: number | null = null;
    for (let k = Math.max(1, g); k <= costs.length; k += 1) {
      const candidate = costs[k - 1];
      if (candidate != null) {
        value = candidate;
        break;
      }
    }
    out.push(value ?? fallback);
  }
  return out;
}
