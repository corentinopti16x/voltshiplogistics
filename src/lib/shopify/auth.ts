import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export type OAuthReturnTo = "client" | "admin";
export type OAuthLocale = "fr" | "en";

export type OAuthState = {
  clientId: string;
  nonce: string;
  exp: number;
  /** Where to send the user after the callback. Defaults to "admin" for legacy states. */
  returnTo?: OAuthReturnTo;
  /** UI locale to use for the post-callback redirect. */
  locale?: OAuthLocale;
};

/** OAuth states are only valid for 10 minutes. */
export const SHOPIFY_STATE_TTL_MS = 10 * 60 * 1000;

function secret() {
  const value = process.env.SHOPIFY_API_SECRET;
  if (!value) throw new Error("SHOPIFY_API_SECRET is not configured.");
  return value;
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createShopifyState(state: OAuthState) {
  const encoded = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function parseShopifyState(value: string): OAuthState | null {
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    const state = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthState;
    return state.exp > Date.now() ? state : null;
  } catch {
    return null;
  }
}

export function verifyShopifyQueryHmac(params: URLSearchParams, appSecret?: string) {
  const supplied = params.get("hmac");
  if (!supplied) return false;
  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const expected = createHmac("sha256", appSecret ?? secret()).update(message).digest("hex");
  const actual = Buffer.from(supplied, "hex");
  const wanted = Buffer.from(expected, "hex");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function verifyShopifyWebhookHmac(
  rawBody: string,
  supplied: string | null,
  appSecret?: string,
) {
  if (!supplied) return false;
  const expected = createHmac("sha256", appSecret ?? secret()).update(rawBody).digest("base64");
  const actual = Buffer.from(supplied);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

/**
 * Accepts "mystore", "mystore.myshopify.com", "https://mystore.myshopify.com/"
 * and returns the canonical "mystore.myshopify.com" (or null when invalid).
 */
export function normalizeShopDomain(value: string) {
  let domain = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/[?#].*$/, "");
  if (domain && !domain.includes(".")) domain = `${domain}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain) ? domain : null;
}

/** Path prefix for a locale under next-intl's "as-needed" strategy (default locale "en" has none). */
export function localePathPrefix(locale: OAuthLocale | undefined) {
  return locale === "fr" ? "/fr" : "";
}

/** Builds the Shopify authorization URL (step 1 of the OAuth grant). */
export function buildShopifyAuthorizeUrl(input: {
  shop: string;
  appUrl: string;
  state: Omit<OAuthState, "nonce" | "exp">;
  /** Client ID of the store's dedicated custom app; defaults to SHOPIFY_API_KEY. */
  apiKey?: string;
}) {
  const apiKey = input.apiKey ?? process.env.SHOPIFY_API_KEY;
  if (!apiKey) throw new Error("SHOPIFY_API_KEY is not configured.");
  const scopes = (process.env.SHOPIFY_SCOPES ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean)
    .join(",");
  if (!scopes) throw new Error("SHOPIFY_SCOPES is not configured.");
  const state = createShopifyState({
    ...input.state,
    nonce: randomBytes(16).toString("hex"),
    exp: Date.now() + SHOPIFY_STATE_TTL_MS,
  });
  const params = new URLSearchParams({
    client_id: apiKey,
    scope: scopes,
    redirect_uri: `${input.appUrl.replace(/\/$/, "")}/api/shopify/callback`,
    state,
  });
  return `https://${input.shop}/admin/oauth/authorize?${params.toString()}`;
}
