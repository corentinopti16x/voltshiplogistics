/**
 * Customs pre-fill for the sourcing form: a generic declared name (ZH / EN), the HS code
 * and typical packed dimensions, guessed from the product title. The sourcer checks and
 * saves; nothing is written without him. Only common categories, the rest stays manual.
 */
export type CustomsPreset = {
  key: string;
  declaredNameZh: string;
  declaredNameEn: string;
  hsCode: string;
  dimensionsCm: [number, number, number] | null;
};

const PRESETS: { match: RegExp; preset: CustomsPreset }[] = [
  {
    // Gift box / coffret first: "Coffret collier" is a box, not a necklace.
    match: /coffret|gift ?box|bo[iî]te cadeau|geschenkbox|礼盒/i,
    preset: { key: "giftBox", declaredNameZh: "礼品盒", declaredNameEn: "Gift box", hsCode: "481920", dimensionsCm: [10, 10, 5] },
  },
  {
    match: /collier|necklace|halskette|pendentif|pendant|项链/i,
    preset: { key: "necklace", declaredNameZh: "不锈钢项链", declaredNameEn: "Stainless steel necklace", hsCode: "711719", dimensionsCm: [10, 8, 1] },
  },
  {
    match: /bracelet|gourmette|armband|bangle|手链/i,
    preset: { key: "bracelet", declaredNameZh: "不锈钢手链", declaredNameEn: "Stainless steel bracelet", hsCode: "711719", dimensionsCm: [10, 8, 1] },
  },
  {
    match: /\bbague|\bring\b|\bringe?\b|戒指/i,
    preset: { key: "ring", declaredNameZh: "不锈钢戒指", declaredNameEn: "Stainless steel ring", hsCode: "711719", dimensionsCm: [8, 6, 1] },
  },
  {
    match: /boucles? d.oreilles?|earrings?|ohrringe|耳环/i,
    preset: { key: "earrings", declaredNameZh: "不锈钢耳环", declaredNameEn: "Stainless steel earrings", hsCode: "711719", dimensionsCm: [8, 6, 1] },
  },
];

export function customsPresetFor(title: string | null | undefined): CustomsPreset | null {
  const text = String(title ?? "");
  if (!text.trim()) return null;
  return PRESETS.find((entry) => entry.match.test(text))?.preset ?? null;
}
