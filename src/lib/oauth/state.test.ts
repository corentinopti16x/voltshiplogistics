import { describe, expect, it } from "vitest";
import { createOAuthState, parseOAuthState } from "./state";

describe("oauth state", () => {
  it("round-trips, rejects tampering and expiry", () => {
    const state = createOAuthState("s3cret", { clientId: "c1", locale: "fr" }, { now: 1_000 });
    const parsed = parseOAuthState<{ clientId: string; locale: string }>("s3cret", state, 2_000);
    expect(parsed?.clientId).toBe("c1");
    expect(parsed?.locale).toBe("fr");
    expect(parseOAuthState("other", state, 2_000)).toBeNull();
    expect(parseOAuthState("s3cret", `${state}x`, 2_000)).toBeNull();
    expect(parseOAuthState("s3cret", state, 1_000 + 11 * 60 * 1000)).toBeNull();
    expect(parseOAuthState("s3cret", null)).toBeNull();
  });
});
