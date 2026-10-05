import type { PlanTier } from "@/lib/auth/types";
import type { ResearchKind } from "@/lib/products/types";

const tierRank: Record<PlanTier, number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
  scale: 3,
};

const minimumTier: Record<ResearchKind, PlanTier> = {
  brief: "bronze",
  reddit: "silver",
  personas: "bronze",
};

const monthlyQuota: Record<PlanTier, number> = {
  bronze: 10,
  silver: 30,
  gold: 100,
  scale: 300,
};

export function canGenerateResearch(tier: PlanTier, kind: ResearchKind) {
  return tierRank[tier] >= tierRank[minimumTier[kind]];
}

export function researchMinimumTier(kind: ResearchKind) {
  return minimumTier[kind];
}

export function researchMonthlyQuota(tier: PlanTier) {
  return monthlyQuota[tier];
}
