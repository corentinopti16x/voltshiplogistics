import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

type OAuthState = {
  clientId: string;
  nonce: string;
  exp: number;
};

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

export function verifyShopifyQueryHmac(params: URLSearchParams) {
  const supplied = params.get("hmac");
  if (!supplied) return false;
  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const expected = createHmac("sha256", secret()).update(message).digest("hex");
  const actual = Buffer.from(supplied, "hex");
  const wanted = Buffer.from(expected, "hex");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function verifyShopifyWebhookHmac(rawBody: string, supplied: string | null) {
  if (!supplied) return false;
  const expected = createHmac("sha256", secret()).update(rawBody).digest("base64");
  const actual = Buffer.from(supplied);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function normalizeShopDomain(value: string) {
  const domain = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain) ? domain : null;
}
