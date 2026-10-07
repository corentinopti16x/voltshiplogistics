import { describe, expect, it } from "vitest";
import { cogsForQuantity } from "./average-order";

const ladder = [
  { quantity: 1, cogs: 7.9 },
  { quantity: 2, cogs: 10.55 },
  { quantity: 3, cogs: 13.2 },
  { quantity: 4, cogs: 15.85 },
  { quantity: 5, cogs: null },
];

describe("cogsForQuantity", () => {
  it("returns the ladder value for whole quantities", () => {
    expect(cogsForQuantity(ladder, 2)).toBeCloseTo(10.55);
  });
  it("interpolates between two steps", () => {
    expect(cogsForQuantity(ladder, 1.4)).toBeCloseTo(7.9 + 0.4 * 2.65);
  });
  it("extends the last increment beyond the ladder", () => {
    expect(cogsForQuantity(ladder, 5)).toBeCloseTo(18.5);
  });
  it("is null without data", () => {
    expect(cogsForQuantity([], 2)).toBeNull();
    expect(cogsForQuantity(ladder, 0)).toBeNull();
  });
});
