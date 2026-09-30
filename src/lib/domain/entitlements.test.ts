import { describe, expect, it } from "vitest";
import {
  canGenerateResearch,
  researchMinimumTier,
  researchMonthlyQuota,
} from "./entitlements";

describe("research entitlements", () => {
  it("keeps Reddit research on silver and above", () => {
    expect(canGenerateResearch("bronze", "reddit")).toBe(false);
    expect(canGenerateResearch("silver", "reddit")).toBe(true);
    expect(researchMinimumTier("reddit")).toBe("silver");
  });

  it("raises monthly quotas by tier", () => {
    expect(researchMonthlyQuota("bronze")).toBeLessThan(
      researchMonthlyQuota("gold"),
    );
  });
});
