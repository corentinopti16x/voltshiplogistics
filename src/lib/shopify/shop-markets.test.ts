import { describe, expect, it } from "vitest";
import { formatShopMarkets, parseShopMarkets } from "./shop-markets";

describe("shop markets", () => {
  it("keeps the main country first, without duplicates", () => {
    expect(parseShopMarkets("FR,BE, ch;be")).toEqual(["FR", "BE", "CH"]);
    expect(parseShopMarkets(null)).toEqual([]);
    expect(formatShopMarkets("FR", ["BE", "CH", "LU", "FR"])).toBe("FR,BE,CH,LU");
    expect(formatShopMarkets("US", [])).toBe("US");
    expect(formatShopMarkets("", ["BE"])).toBe("");
  });
});
