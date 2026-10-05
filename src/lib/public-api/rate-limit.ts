/**
 * In-memory token bucket, 60 req/min per key by default.
 *
 * CAVEAT: on Vercel (and any multi-instance deploy) each serverless instance keeps its own
 * buckets, so the effective limit is "60/min per key per warm instance" and resets on cold
 * starts. Good enough to stop a runaway support integration; swap for Upstash/Redis if a
 * strict global limit is ever needed.
 */

type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();

export const RATE_LIMIT_PER_MINUTE = 60;

export function takeToken(
  key: string,
  options: { limit?: number; now?: number; store?: Map<string, Bucket> } = {},
) {
  const limit = options.limit ?? RATE_LIMIT_PER_MINUTE;
  const now = options.now ?? Date.now();
  const store = options.store ?? buckets;
  const refillPerMs = limit / 60_000;
  const bucket = store.get(key) ?? { tokens: limit, updatedAt: now };
  bucket.tokens = Math.min(limit, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
  bucket.updatedAt = now;
  if (bucket.tokens < 1) {
    store.set(key, bucket);
    const retryAfterSeconds = Math.ceil((1 - bucket.tokens) / refillPerMs / 1000);
    return { allowed: false as const, remaining: 0, retryAfterSeconds };
  }
  bucket.tokens -= 1;
  store.set(key, bucket);
  // Opportunistic GC so the map cannot grow without bound on a long-lived instance.
  if (store.size > 5_000) {
    for (const [k, b] of store) if (now - b.updatedAt > 120_000) store.delete(k);
  }
  return { allowed: true as const, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
}
