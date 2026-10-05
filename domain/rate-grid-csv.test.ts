import { describe, expect, it } from "vitest";
import { parseRateGridCsv, RATE_GRID_CSV_TEMPLATE } from "./rate-grid-csv";

describe("rate grid CSV", () => {
  it("parses a valid rate sheet", () => {
    const result = parseRateGridCsv(RATE_GRID_CSV_TEMPLATE);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      carrier: "YunExpress",
      destination: "FR",
      channel: "standard",
      weightMinG: 0,
      weightMaxG: 500,
      price: 3.9,
    });
  });

  it("reports invalid and duplicate rows", () => {
    const result = parseRateGridCsv(`carrier,destination,channel,weight_min_g,weight_max_g,price,delivery_range
YunExpress,France,standard,0,500,3.90,
YunExpress,FR,standard,0,500,3.90,
YunExpress,FR,standard,0,500,4.10,
`);
    expect(result.rows).toHaveLength(1);
    expect(result.errors.join(" ")).toContain("destination");
    expect(result.errors.join(" ")).toContain("duplicate");
  });
});
