import { describe, expect, it } from "vitest";
import { detectOrderAnomalies } from "./anomalies";

describe("detectOrderAnomalies", () => {
  it("leaves a normal order alone", () => {
    const result = detectOrderAnomalies({ total: "32.90", gross: "39.90", discounts: "7.00", units: 1 });
    expect(result.reasons).toEqual([]);
  });

  it("flags the coffret abuse (#9872: 50 units for 2.99)", () => {
    const result = detectOrderAnomalies({
      total: "2.99",
      gross: "1495.00",
      discounts: "1492.01",
      discountCodes: [{ code: "BIENVENUE" }],
      units: 50,
    });
    expect(result.reasons).toEqual(["price_anomaly", "discount_abuse", "quantity_spike"]);
    expect(result.details.discount_codes).toEqual(["BIENVENUE"]);
    expect(result.details.discount_pct).toBe(99.8);
  });

  it("flags free orders without counting the discount twice", () => {
    const result = detectOrderAnomalies({ total: "0.00", gross: "29.90", discounts: "29.90", units: 1 });
    expect(result.reasons).toEqual(["zero_total"]);
  });

  it("flags heavy discounts", () => {
    const result = detectOrderAnomalies({ total: "12.00", gross: "40.00", discounts: "28.00", units: 2 });
    expect(result.reasons).toEqual(["discount_abuse"]);
    expect(result.details.discount_pct).toBe(70);
  });

  it("flags big quantities that are paid normally", () => {
    const result = detectOrderAnomalies({ total: "290.00", gross: "290.00", discounts: "0", units: 12 });
    expect(result.reasons).toEqual(["quantity_spike"]);
  });

  it("ignores missing amounts", () => {
    expect(detectOrderAnomalies({ total: null, units: 1 }).reasons).toEqual([]);
  });
});
