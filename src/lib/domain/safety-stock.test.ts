import { describe, expect, it } from "vitest";
import { calculateSafetyStock } from "./safety-stock";

describe("safety stock", () => {
  it("calculates reorder point and suggested quantity", () => {
    expect(
      calculateSafetyStock({
        qtyAvailable: 100,
        qtyReserved: 10,
        inboundQty: 20,
        salesPerDay: 5,
        productionLeadDays: 20,
        shippingDays: 10,
        bufferDays: 7,
        coverageTargetDays: 60,
      }),
    ).toMatchObject({
      daysLeft: 18,
      reorderPoint: 185,
      suggestedQty: 190,
      status: "reorder",
    });
  });

  it("rounds the suggested quantity up to the MOQ", () => {
    expect(
      calculateSafetyStock({
        qtyAvailable: 10,
        salesPerDay: 1,
        productionLeadDays: 0,
        shippingDays: 0,
        bufferDays: 0,
        coverageTargetDays: 25,
        moq: 20,
      }).suggestedQty,
    ).toBe(20);
  });

  it("does not divide by zero without sales", () => {
    expect(
      calculateSafetyStock({
        qtyAvailable: 10,
        salesPerDay: 0,
      }),
    ).toMatchObject({ daysLeft: null, status: "ok", suggestedQty: 0 });
  });
});
