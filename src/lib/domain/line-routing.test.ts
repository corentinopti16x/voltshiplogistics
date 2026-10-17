import { describe, expect, it } from "vitest";
import type { RateCell } from "./pricing";
import {
  buildCoverageIndex,
  checkParcelLine,
  lineCoversZip,
  normalizeZip,
  parseZipList,
  rankLines,
  zipInList,
} from "./line-routing";

// USA electronics grid of 12 Oct. 2026, carrier cost (RMB) per parcel at 101-150 g / 301-350 g.
const cell = (carrier: string, lineName: string, min: number, max: number, costRmb: number): RateCell => ({
  gridVersion: "V3",
  carrier,
  destination: "US",
  channel: "electronics_battery",
  weightMinG: min,
  weightMaxG: max,
  price: Math.round((costRmb / 7.5) * 1.1 * 100) / 100,
  deliveryRange: null,
  lineName,
  iossRequired: false,
  carrierCostRmb: costRmb,
});
const HUAHAN_INTERNAL = "智尚选-内电 PK0590";
const SHANGPAI = "商派特惠带电 YTSPTHDD";
const TEHUI = "特惠带电 THZXR";
const TONGYOU = "美国专线带电";
const cells: RateCell[] = [
  cell("Huahan", HUAHAN_INTERNAL, 101, 150, 27.8),
  cell("YunExpress", SHANGPAI, 101, 150, 30.8),
  cell("Tongyou", TONGYOU, 101, 150, 33.68),
  cell("YunExpress", TEHUI, 101, 150, 33.96),
  cell("Huahan", HUAHAN_INTERNAL, 301, 350, 42.09),
  cell("YunExpress", SHANGPAI, 301, 350, 47.48),
  cell("Tongyou", TONGYOU, 301, 350, 51.21),
  cell("YunExpress", TEHUI, 301, 350, 53.24),
];
const AUTO = ["YunExpress", "Tongyou"];
const translator = {
  destination: "US",
  channel: "electronics_battery" as const,
  weightG: 120,
  batteryInternal: true,
  fxRmbPerEur: 7.5,
};

describe("postcodes", () => {
  it("normalises US ZIPs (ZIP+4, lost leading zero) and other markets", () => {
    expect(normalizeZip("US", "10001-1234")).toBe("10001");
    expect(normalizeZip("US", "2134")).toBe("02134");
    expect(normalizeZip("US", "100011234")).toBe("10001");
    expect(normalizeZip("US", "ABC")).toBeNull();
    expect(normalizeZip("FR", " 75 011 ")).toBe("75011");
    expect(normalizeZip("US", "")).toBeNull();
  });

  it("parses a pasted list: codes, ZIP+4, Excel-stripped zeros, prefixes and ranges", () => {
    const { zips, invalid } = parseZipList("US", "10001\n10002, 2134;100011234\t945\n90210-90212 hello 10003-1234");
    expect(zips).toEqual(["02134", "10001", "10002", "10003", "90210", "90211", "90212", "945"]);
    expect(invalid).toEqual(["hello"]);
  });

  it("restores the leading zero of 4-digit codes and ranges in 5-digit markets", () => {
    expect(parseZipList("US", "2101-2103").zips).toEqual(["02101", "02102", "02103"]);
    expect(parseZipList("FR", "1000 75011").zips).toEqual(["01000", "75011"]);
    expect(parseZipList("BE", "1000").zips).toEqual(["1000"]);
  });

  it("matches a code by itself or by one of its prefixes", () => {
    const entries = new Set(["945", "10001"]);
    expect(zipInList(entries, "94501")).toBe(true);
    expect(zipInList(entries, "10001")).toBe(true);
    expect(zipInList(entries, "10002")).toBe(false);
  });

  it("reads 'only' and 'except' lists, null when the line has none", () => {
    const index = buildCoverageIndex([
      { destination: "US", carrier: "Huahan", lineName: HUAHAN_INTERNAL, mode: "only", zips: ["100"] },
      { destination: "US", carrier: "YunExpress", lineName: SHANGPAI, mode: "except", zips: ["995", "996"] },
    ]);
    const huahan = { carrier: "Huahan", lineName: HUAHAN_INTERNAL };
    const shangpai = { carrier: "YunExpress", lineName: SHANGPAI };
    expect(lineCoversZip(index, "US", huahan, "10001")).toBe(true);
    expect(lineCoversZip(index, "US", huahan, "90210")).toBe(false);
    expect(lineCoversZip(index, "US", shangpai, "99501")).toBe(false);
    expect(lineCoversZip(index, "US", shangpai, "90210")).toBe(true);
    expect(lineCoversZip(index, "US", { carrier: "Tongyou", lineName: TONGYOU }, "90210")).toBeNull();
    // Unknown postcode: an "only" list cannot say yes, an "except" list does not exclude it.
    expect(lineCoversZip(index, "US", huahan, null)).toBe(false);
    expect(lineCoversZip(index, "US", shangpai, null)).toBe(true);
  });
});

describe("rankLines", () => {
  const huahanList = { destination: "US", carrier: "Huahan", lineName: HUAHAN_INTERNAL, mode: "only" as const, zips: ["100"] };
  const shangpaiExcept = { destination: "US", carrier: "YunExpress", lineName: SHANGPAI, mode: "except" as const, zips: ["995"] };

  it("leaves Huahan out until its postcode list is imported (not an automatic US carrier)", () => {
    const { best, options } = rankLines(cells, { ...translator, zip: "10001" }, buildCoverageIndex([]), AUTO);
    expect(best?.lineName).toBe(SHANGPAI);
    expect(best?.costRmb).toBe(30.8);
    expect(options.find((option) => option.carrier === "Huahan")?.reason).toBe("no_zip_list");
  });

  it("ships on Huahan 内电 when the postcode is on its list, else on 商派", () => {
    const index = buildCoverageIndex([huahanList]);
    expect(rankLines(cells, { ...translator, zip: "10001" }, index, AUTO).best?.carrier).toBe("Huahan");
    const outside = rankLines(cells, { ...translator, zip: "90210" }, index, AUTO);
    expect(outside.best?.lineName).toBe(SHANGPAI);
    expect(outside.options.find((option) => option.carrier === "Huahan")?.reason).toBe("zip_not_covered");
  });

  it("falls back to the next cheapest line (Tongyou, not 特惠) when 商派 does not cover the postcode", () => {
    const { best } = rankLines(cells, { ...translator, zip: "99501" }, buildCoverageIndex([huahanList, shangpaiExcept]), AUTO);
    expect(best?.carrier).toBe("Tongyou");
  });

  it("never offers Huahan 内电 to a product without a built-in battery", () => {
    const { options } = rankLines(cells, { ...translator, batteryInternal: false, zip: "10001" }, buildCoverageIndex([huahanList]), AUTO);
    expect(options.some((option) => option.lineName === HUAHAN_INTERNAL)).toBe(false);
  });

  it("uses the forced / chosen line when it is eligible, never a carrier without postcode list", () => {
    const preferredLine = { carrier: "YunExpress", lineName: TEHUI };
    expect(rankLines(cells, { ...translator, zip: "10001", preferredLine }, buildCoverageIndex([]), AUTO).best?.lineName).toBe(TEHUI);
    const huahan = { carrier: "Huahan", lineName: HUAHAN_INTERNAL };
    // No Huahan list yet: the chosen Huahan line is not used (cheapest eligible instead).
    expect(rankLines(cells, { ...translator, zip: "10001", preferredLine: huahan }, buildCoverageIndex([]), AUTO).best?.lineName).toBe(SHANGPAI);
    const listed = buildCoverageIndex([huahanList]);
    expect(rankLines(cells, { ...translator, zip: "10001", preferredLine: huahan }, listed, AUTO).best?.carrier).toBe("Huahan");
    expect(rankLines(cells, { ...translator, zip: "90210", preferredLine: huahan }, listed, AUTO).best?.lineName).toBe(SHANGPAI);
  });

  it("ranks lines without carrier cost after the costed ones and compares them on price", () => {
    const noCost = cells.map((item) => (item.carrier === "Tongyou" ? { ...item, carrierCostRmb: null, price: 1 } : item));
    const { options } = rankLines(noCost, { ...translator, zip: "10001" }, buildCoverageIndex([]), AUTO);
    expect(options[options.length - 1].carrier).toBe("Tongyou");
    expect(options[options.length - 1].costRmb).toBeNull();
    const check = checkParcelLine(noCost, { ...translator, zip: "10001" }, buildCoverageIndex([]), AUTO, { carrier: "Tongyou", lineName: TONGYOU });
    expect(check.extraRmb).toBeNull();
    expect(check.status).toBe("cheaper");
  });

  it("keeps blocked lines out", () => {
    const allowedLines = new Set([`YunExpress|${TEHUI}`, `Tongyou|${TONGYOU}`]);
    const { best } = rankLines(cells, { ...translator, zip: "10001", allowedLines }, buildCoverageIndex([]), AUTO);
    expect(best?.carrier).toBe("Tongyou");
  });

  it("returns no line when nothing can take the weight", () => {
    expect(rankLines(cells, { ...translator, weightG: 600, zip: "10001" }, buildCoverageIndex([]), AUTO).best).toBeNull();
  });
});

describe("checkParcelLine (planned vs actual)", () => {
  const index = buildCoverageIndex([]);

  it("flags a 1-translator parcel sent on 特惠 instead of 商派: +3.16 RMB", () => {
    const check = checkParcelLine(cells, { ...translator, zip: "10001" }, index, AUTO, { carrier: "YunExpress", lineName: TEHUI });
    expect(check.status).toBe("more_expensive");
    expect(check.planned?.lineName).toBe(SHANGPAI);
    expect(check.extraRmb).toBe(3.16);
  });

  it("flags a 2 + 2 parcel (317 g) sent on 特惠: +5.76 RMB", () => {
    const check = checkParcelLine(cells, { ...translator, weightG: 317, zip: "10001" }, index, AUTO, {
      carrier: "YunExpress",
      lineName: TEHUI,
    });
    expect(check.extraRmb).toBe(5.76);
  });

  it("is ok on the planned line", () => {
    const check = checkParcelLine(cells, { ...translator, zip: "10001" }, index, AUTO, { carrier: "YunExpress", lineName: SHANGPAI });
    expect(check).toMatchObject({ status: "ok", extraRmb: 0 });
  });

  it("prices a parcel sent on Huahan without a list as cheaper than planned", () => {
    const check = checkParcelLine(cells, { ...translator, zip: "10001" }, index, AUTO, { carrier: "Huahan", lineName: HUAHAN_INTERNAL });
    expect(check.status).toBe("cheaper");
    expect(check.extraRmb).toBe(-3);
  });

  it("reports a line missing from the grid (unmapped ECCANG method)", () => {
    const check = checkParcelLine(cells, { ...translator, zip: "10001" }, index, AUTO, null);
    expect(check.status).toBe("unknown_line");
    expect(check.planned?.lineName).toBe(SHANGPAI);
  });
});
