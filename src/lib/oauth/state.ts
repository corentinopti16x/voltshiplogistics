import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Generic signed OAuth `state` (HMAC-SHA256, base64url) — same scheme as the Shopify
 * flow (src/lib/shopify/auth.ts) but with the secret injected so any provider can reuse it.
 * Pure (no server-only import) so it is unit-testable.
 */

export type SignedState<T extends object> = T & { nonce: string; exp: number };

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function sign(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createOAuthState<T extends object>(
  secret: string,
  payload: T,
  options: { ttlMs?: number; now?: number } = {},
) {
  const state: SignedState<T> = {
    ...payload,
    nonce: randomBytes(16).toString("hex"),
    exp: (options.now ?? Date.now()) + (options.ttlMs ?? OAUTH_STATE_TTL_MS),
  };
  const encoded = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${encoded}.${sign(secret, encoded)}`;
}

export function parseOAuthState<T extends object>(
  secret: string,
  value: string | null | undefined,
  now = Date.now(),
): SignedState<T> | null {
  if (!value) return null;
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = Buffer.from(sign(secret, encoded));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SignedState<T>;
    return typeof state.exp === "number" && state.exp > now ? state : null;
  } catch {
    return null;
  }
}
