import { describe, expect, it } from "vitest";
import { takeToken } from "./rate-limit";

describe("takeToken", () => {
  it("allows 60 calls per minute then refills over time", () => {
    const store = new Map();
    let now = 1_000_000;
    for (let i = 0; i < 60; i += 1) expect(takeToken("k", { store, now }).allowed).toBe(true);
    const blocked = takeToken("k", { store, now });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    now += 30_000;
    expect(takeToken("k", { store, now }).remaining).toBe(29);
    expect(takeToken("other", { store, now }).allowed).toBe(true);
  });
});
