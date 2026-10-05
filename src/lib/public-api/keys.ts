import { createHash, randomBytes } from "crypto";

/**
 * Public API keys: `vs_live_<48 hex chars>`. Only the SHA-256 of the full key is stored
 * (api_keys.key_hash) together with a short prefix for display. Pure helpers (tested).
 */

export const API_KEY_PREFIX = "vs_live_";
export const API_KEY_SCOPES = ["orders:read"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export function hashApiKey(key: string) {
  return createHash("sha256").update(key.trim()).digest("hex");
}

/** Display prefix: "vs_live_ab12cd34…" (first 8 chars of the secret part). */
export function apiKeyDisplayPrefix(key: string) {
  return `${key.slice(0, API_KEY_PREFIX.length + 8)}…`;
}

export function generateApiKey(random: () => Buffer = () => randomBytes(24)) {
  const key = `${API_KEY_PREFIX}${random().toString("hex")}`;
  return { key, hash: hashApiKey(key), prefix: apiKeyDisplayPrefix(key) };
}

export function looksLikeApiKey(value: string) {
  return /^vs_live_[a-f0-9]{48}$/.test(value.trim());
}

/** `Authorization: Bearer vs_live_…` → the key, or null when absent / malformed. */
export function bearerApiKey(authorization: string | null | undefined) {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!match) return null;
  return looksLikeApiKey(match[1]) ? match[1] : null;
}

export type ApiKeyRecord = {
  id: string;
  client_id: string;
  scopes: string[] | null;
  revoked_at: string | null;
};

/** Pure lookup against already-loaded rows (the server wrapper filters by key_hash). */
export function resolveApiKey(
  key: string | null,
  rowForHash: (hash: string) => ApiKeyRecord | null | undefined,
  scope: ApiKeyScope = "orders:read",
) {
  if (!key) return { ok: false as const, reason: "missing" as const };
  const row = rowForHash(hashApiKey(key));
  if (!row) return { ok: false as const, reason: "unknown" as const };
  if (row.revoked_at) return { ok: false as const, reason: "revoked" as const };
  if (!(row.scopes ?? []).includes(scope)) return { ok: false as const, reason: "scope" as const };
  return { ok: true as const, key: row };
}
