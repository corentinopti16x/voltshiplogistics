import { describe, expect, it } from "vitest";
import {
  ageBucket,
  ageInDays,
  buildBuyList,
  buyListCsv,
  eccangStateOf,
  isPendingShipment,
  orderRefKey,
  pendingOrdersCsv,
  summarizeShops,
  toCsv,
  type CatalogEntry,
  type PendingOrder,
} from "./to-ship";

function order(partial: Partial<PendingOrder>): PendingOrder {
  return {
    clientId: "c1",
    clientName: "Maxime",
    shopId: "s1",
    shopDomain: "shop-us",
    market: "US",
    orderId: "1",
    name: "#1001",
    date: "2026-10-10",
    ageDays: 2,
    lines: [],
    units: 0,
    unitsWithoutSku: 0,
    partial: false,
    flagged: false,
    eccang: "none",
    eccangTracking: null,
    ...partial,
  };
}

function entry(partial: Partial<CatalogEntry>): CatalogEntry {
  return {
    productId: "p1",
    title: "Traducteur",
    isUpsell: false,
    stock: null,
    incoming: 0,
    leadDays: null,
    factoryPriceRmb: null,
    supplier: null,
    packPieces: 1,
    ...partial,
  };
}

describe("ages", () => {
  it("counts whole UTC days and buckets them", () => {
    const today = new Date("2026-10-12T10:00:00Z");
    expect(ageInDays("2026-10-12", today)).toBe(0);
    expect(ageInDays("2026-10-10", today)).toBe(2);
    expect(ageInDays("2026-08-27", today)).toBe(46);
    expect(ageBucket(0)).toBe("d0_2");
    expect(ageBucket(3)).toBe("d3_7");
    expect(ageBucket(8)).toBe("d8_30");
    expect(ageBucket(31)).toBe("d31");
  });
});

describe("isPendingShipment", () => {
  it("keeps unfulfilled and partial orders, drops fulfilled and abusive ones", () => {
    expect(isPendingShipment({ fulfilled: false, shipping: null, review: null })).toBe(true);
    expect(isPendingShipment({ fulfilled: null, shipping: null, review: null })).toBe(true);
    expect(isPendingShipment({ fulfilled: true, shipping: null, review: null })).toBe(false);
    const ship = { trackingNumbers: [], company: null, url: null, shippedAt: null };
    expect(isPendingShipment({ fulfilled: false, shipping: { ...ship, status: "fulfilled" }, review: null })).toBe(false);
    expect(isPendingShipment({ fulfilled: false, shipping: { ...ship, status: "partial" }, review: null })).toBe(true);
    expect(isPendingShipment({ fulfilled: false, shipping: null, review: "abuse" })).toBe(false);
  });
});

describe("ECCANG matching", () => {
  it("normalises order references and statuses", () => {
    expect(orderRefKey("#14109")).toBe("14109");
    expect(orderRefKey(" 14109 ")).toBe("14109");
    expect(orderRefKey("")).toBeNull();
    expect(eccangStateOf("D", "OC1")).toBe("shipped");
    expect(eccangStateOf("W", "OC1")).toBe("pending");
    expect(eccangStateOf("pending", null)).toBe("none");
    expect(eccangStateOf("X", "OC1")).toBe("none");
  });
});

describe("summarizeShops", () => {
  it("groups by shop with age buckets and ECCANG states", () => {
    const rows = summarizeShops([
      order({ orderId: "1", ageDays: 1, units: 2 }),
      order({ orderId: "2", ageDays: 40, units: 1, eccang: "pending" }),
      order({ orderId: "3", shopId: "s2", shopDomain: "shop-fr", ageDays: 5, units: 1, flagged: true }),
    ]);
    expect(rows[0]).toMatchObject({ shopId: "s1", orders: 2, units: 3, inEccang: 1 });
    expect(rows[0].buckets).toEqual({ d0_2: 1, d3_7: 0, d8_30: 0, d31: 1 });
    expect(rows[1]).toMatchObject({ shopId: "s2", orders: 1, flagged: 1 });
  });
});

describe("buildBuyList", () => {
  const catalog = new Map([
    [
      "c1",
      new Map<string, CatalogEntry>([
        ["trad", entry({ stock: 100, incoming: 50, leadDays: 5, factoryPriceRmb: 80 })],
        ["case2", entry({ productId: "p2", title: "2 FREE cases", isUpsell: true, packPieces: 2 })],
      ]),
    ],
  ]);

  it("adds sales over lead time + cover to the backlog, minus stock and incoming", () => {
    const pending = [
      order({ orderId: "1", lines: [{ sku: "TRAD", quantity: 2 }, { sku: "case2", quantity: 1 }] }),
      order({ orderId: "2", lines: [{ sku: "trad", quantity: 1 }] }),
      // Already left with ECCANG: no longer owed.
      order({ orderId: "3", eccang: "shipped", lines: [{ sku: "trad", quantity: 5 }] }),
    ];
    const sold = new Map([
      ["c1|trad", { clientId: "c1", clientName: "Maxime", sku: "trad", title: null, units: 140 }],
      ["c1|case2", { clientId: "c1", clientName: "Maxime", sku: "case2", title: null, units: 14 }],
    ]);
    const lines = buildBuyList(pending, sold, catalog, { coverDays: 14, defaultLeadDays: 7, salesWindowDays: 14 });
    const trad = lines.find((line) => line.sku.toLowerCase() === "trad")!;
    // backlog 3 + 10/day × (5 + 14) = 193; − 100 stock − 50 incoming = 43
    expect(trad).toMatchObject({ backlog: 3, orders: 2, perDay: 10, need: 193, toBuy: 43, totalRmb: 3440, leadDays: 5 });
    // (100 + 50 − 3) / 10 = 14 days ≥ 5 days of lead time: not urgent
    expect(trad.runwayDays).toBe(14);
    expect(trad.urgent).toBe(false);
    const cases = lines.find((line) => line.sku === "case2")!;
    // sets of 2: backlog 2 pieces, 2 pieces/day × (7 + 14) = 42 → 44, no stock known
    expect(cases).toMatchObject({ backlog: 2, perDay: 2, need: 44, toBuy: 44, isUpsell: true, stock: null });
    expect(cases.urgent).toBe(true);
  });

  it("lists SKUs without product sheet and drops SKUs with neither sales nor backlog", () => {
    const lines = buildBuyList(
      [order({ lines: [{ sku: "mystery", quantity: 3, title: "Gift" }] })],
      new Map([["c1|old", { clientId: "c1", clientName: "Maxime", sku: "old", title: null, units: 0 }]]),
      catalog,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sku: "mystery", productId: null, title: "Gift", backlog: 3, toBuy: 3 });
  });
});

describe("CSV", () => {
  it("writes a BOM, semicolons, decimal commas and quotes when needed", () => {
    expect(toCsv([["a;b", 1.5, null, 'say "hi"']])).toBe('﻿"a;b";1,5;;"say ""hi"""\r\n');
  });

  it("exports orders line by line and the buying plan", () => {
    const csv = pendingOrdersCsv([order({ lines: [{ sku: "trad", quantity: 2 }], eccang: "pending" })]);
    expect(csv.split("\r\n")[1]).toBe("Maxime;shop-us;US;#1001;2026-10-10;2;trad;2;;;Dans ECCANG;");
    const buy = buyListCsv(
      buildBuyList([order({ lines: [{ sku: "trad", quantity: 1 }] })], new Map(), new Map([["c1", new Map([["trad", entry({})]])]])),
    );
    expect(buy.split("\r\n")).toHaveLength(3);
  });
});
