import { describe, expect, it } from "vitest";
import { detectOrderAnomalies, isGiftLine } from "./anomalies";

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

  it("flags free gifts taken several times (translator offers)", () => {
    const translator = { title: "Smart Voice Language Companion", price: "54.98", quantity: 2 };
    const twoCases = { title: "2 FREE carrying cases", price: "0.00", quantity: 1 };
    const ok = detectOrderAnomalies({ total: "84.98", units: 3, lines: [translator, twoCases] });
    expect(ok.reasons).toEqual([]);
    expect(ok.details).toMatchObject({ gift_units: 1, paid_units: 2 });
    // #14015: the « 2 FREE carrying cases » gift in quantity 2 for the same price
    const twice = detectOrderAnomalies({ total: "84.98", units: 4, lines: [translator, { ...twoCases, quantity: 2 }] });
    expect(twice.reasons).toEqual(["gift_abuse"]);
    // #12717: 1 translator + 2 different gifts
    const stacked = detectOrderAnomalies({
      total: "54.98",
      units: 3,
      lines: [{ ...translator, quantity: 1 }, twoCases, { title: "FREE carrying case", price: "0", quantity: 1 }],
    });
    expect(stacked.reasons).toEqual(["gift_abuse"]);
    // 3 translators + 2 gifts is the 119.99 offer
    const offer = detectOrderAnomalies({
      total: "119.99",
      units: 5,
      lines: [{ ...translator, quantity: 3 }, twoCases, { title: "FREE case + Smart Wallet", price: "10.00", quantity: 1 }],
    });
    expect(offer.reasons).toEqual([]);
  });

  it("recognises gift lines by title or 0 € price", () => {
    expect(isGiftLine({ title: "2 estuches GRATIS" })).toBe(true);
    expect(isGiftLine({ title: "Bracelet offert" })).toBe(true);
    expect(isGiftLine({ title: "Lingo Bonus Record Set (free gift)" })).toBe(true);
    expect(isGiftLine({ title: "Carrying case", price: "0.00" })).toBe(true);
    expect(isGiftLine({ title: "Freedom Lamp", price: "19.90" })).toBe(false);
    expect(isGiftLine({ title: "Translator Carrying Case", price: "14.98" })).toBe(false);
  });
});
