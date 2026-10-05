import { describe, expect, it } from "vitest";
import { apiKeyDisplayPrefix, bearerApiKey, generateApiKey, hashApiKey, looksLikeApiKey, resolveApiKey } from "./keys";

describe("api keys", () => {
  it("generates vs_live_ keys with a sha256 hash and a display prefix", () => {
    const fixed = Buffer.from("ab".repeat(24), "hex");
    const generated = generateApiKey(() => fixed);
    expect(generated.key).toBe(`vs_live_${"ab".repeat(24)}`);
    expect(looksLikeApiKey(generated.key)).toBe(true);
    expect(generated.hash).toBe(hashApiKey(generated.key));
    expect(generated.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.prefix).toBe("vs_live_abababab…");
    expect(apiKeyDisplayPrefix(generated.key)).toBe(generated.prefix);
  });

  it("parses the Authorization header strictly", () => {
    const key = generateApiKey().key;
    expect(bearerApiKey(`Bearer ${key}`)).toBe(key);
    expect(bearerApiKey(`bearer ${key}`)).toBe(key);
    expect(bearerApiKey(key)).toBeNull();
    expect(bearerApiKey("Bearer sk_test_123")).toBeNull();
    expect(bearerApiKey(null)).toBeNull();
  });

  it("resolves by hash, rejects revoked keys and missing scopes", () => {
    const { key, hash } = generateApiKey();
    const rows = {
      [hash]: { id: "k1", client_id: "c1", scopes: ["orders:read"], revoked_at: null },
    };
    expect(resolveApiKey(key, (h) => rows[h])).toEqual({
      ok: true,
      key: rows[hash],
    });
    expect(resolveApiKey(generateApiKey().key, (h) => rows[h])).toEqual({ ok: false, reason: "unknown" });
    expect(resolveApiKey(null, (h) => rows[h])).toEqual({ ok: false, reason: "missing" });
    expect(
      resolveApiKey(key, () => ({ id: "k1", client_id: "c1", scopes: ["orders:read"], revoked_at: "2026-01-01" })),
    ).toEqual({ ok: false, reason: "revoked" });
    expect(resolveApiKey(key, () => ({ id: "k1", client_id: "c1", scopes: [], revoked_at: null }))).toEqual({
      ok: false,
      reason: "scope",
    });
  });
});
