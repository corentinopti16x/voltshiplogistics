import { describe, expect, it } from "vitest";
import { autoCarriersFor, calculateCogs, isLimitedCoverageCarrier, type RateCell } from "./pricing";
import { parseAutoCarriers, parsePricingSettings } from "../pricing/settings";

const cell = (carrier: string, lineName: string, price: number): RateCell => ({
  gridVersion: "V3",
  carrier,
  destination: "US",
  channel: "electronics_battery",
  weightMinG: 101,
  weightMaxG: 150,
  price,
  deliveryRange: null,
  lineName,
  iossRequired: false,
  carrierCostRmb: null,
});
const cells = [cell("Huahan", "智尚选-特惠 PK0573", 5.2), cell("YunExpress", "特惠带电 THZXR", 6.1), cell("Tongyou", "美国专线带电", 6.4)];
const base = { clientPrice: 2, weightG: 120, channel: "electronics_battery" as const, destination: "US", cells };

describe("US automatic carriers", () => {
  it("defaults to YunExpress and Tongyou for the US only", () => {
    const settings = parsePricingSettings({});
    expect(autoCarriersFor(settings.auto_carriers, "US")).toEqual(["YunExpress", "Tongyou"]);
    expect(autoCarriersFor(settings.auto_carriers, "FR")).toBeNull();
    expect(parseAutoCarriers({})).toEqual({});
  });

  it("skips Huahan for the automatic choice but keeps it when chosen", () => {
    const auto = calculateCogs({ ...base, autoCarriers: ["YunExpress", "Tongyou"] });
    expect(auto?.carrier).toBe("YunExpress");
    const all = calculateCogs(base);
    expect(all?.carrier).toBe("Huahan");
    const chosen = calculateCogs({
      ...base,
      autoCarriers: ["YunExpress", "Tongyou"],
      carrierPreference: { carrier: "Huahan", lineName: "智尚选-特惠 PK0573" },
    });
    expect(chosen?.carrier).toBe("Huahan");
    expect(isLimitedCoverageCarrier("Huahan", ["YunExpress", "Tongyou"])).toBe(true);
    expect(isLimitedCoverageCarrier("tongyou", ["YunExpress", "Tongyou"])).toBe(false);
  });

  it("falls back to any line when no auto carrier can ship", () => {
    const onlyHuahan = calculateCogs({ ...base, cells: [cells[0]], autoCarriers: ["YunExpress", "Tongyou"] });
    expect(onlyHuahan?.carrier).toBe("Huahan");
  });
});
