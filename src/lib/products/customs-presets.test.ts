import { describe, expect, it } from "vitest";
import { customsPresetFor } from "./customs-presets";

describe("customsPresetFor", () => {
  it("recognises LIORA jewelry titles", () => {
    expect(customsPresetFor("Bracelet Maman — Les prénoms de ses enfants")?.hsCode).toBe("711719");
    expect(customsPresetFor("Liora® - Ensemble de bracelets personnalisés")?.declaredNameEn).toBe("Stainless steel bracelet");
    expect(customsPresetFor("Collier Maman — Les prénoms")?.declaredNameZh).toBe("不锈钢项链");
    expect(customsPresetFor("Bague Toi & Moi — Vos Deux Pierres")?.key).toBe("ring");
    expect(customsPresetFor("Mom Necklace — Her Children's Names")?.key).toBe("necklace");
  });

  it("treats a coffret as a gift box, even with a necklace in the name", () => {
    expect(customsPresetFor("Coffret Collier Fete des Meres")?.hsCode).toBe("481920");
  });

  it("returns null when nothing matches", () => {
    expect(customsPresetFor("Magnesium Complex")).toBeNull();
    expect(customsPresetFor("Gilet rafraichissant pour chien")).toBeNull();
    expect(customsPresetFor("")).toBeNull();
  });
});
