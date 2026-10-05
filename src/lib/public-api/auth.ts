import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { bearerApiKey, hashApiKey, resolveApiKey, type ApiKeyRecord } from "./keys";
import { takeToken } from "./rate-limit";

export type PublicAuth =
  | { ok: true; clientId: string; keyId: string }
  | { ok: false; response: Response };

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export function apiError(status: number, message: string, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

export function apiJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Bearer vs_live_… → api_keys (sha256, not revoked) → tenant. Also applies the per-key rate limit. */
export async function authenticatePublicRequest(request: Request): Promise<PublicAuth> {
  const key = bearerApiKey(request.headers.get("authorization"));
  if (!key) return { ok: false, response: apiError(401, "Missing or malformed API key.") };

  const admin = createAdminClient();
  const { data } = await admin
    .from("api_keys")
    .select("id, client_id, scopes, revoked_at")
    .eq("key_hash", hashApiKey(key))
    .maybeSingle<ApiKeyRecord>();
  const resolved = resolveApiKey(key, () => data);
  if (!resolved.ok) return { ok: false, response: apiError(401, "Invalid or revoked API key.") };

  const bucket = takeToken(resolved.key.id);
  if (!bucket.allowed) {
    return {
      ok: false,
      response: apiError(429, "Rate limit exceeded (60 requests per minute).", {
        "retry-after": String(bucket.retryAfterSeconds),
      }),
    };
  }
  // Best-effort, never blocks the response.
  void admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", resolved.key.id);
  return { ok: true, clientId: resolved.key.client_id, keyId: resolved.key.id };
}
