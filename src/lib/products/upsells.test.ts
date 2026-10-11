import { describe, expect, it } from "vitest";
import {
  coPurchases,
  composerItem,
  mergeAutoUpsells,
  parseAutoUpsells,
  parseUpsellIds,
  upsellPairs,
  withUpsell,
} from "./upsells";

describe("upsell links", () => {
  it("reads unique ids only", () => {
    expect(parseUpsellIds({ upsell_ids: ["a", "b", "a", "", 3] })).toEqual(["a", "b"]);
    expect(parseUpsellIds(null)).toEqual([]);
    expect(parseUpsellIds({ upsell_ids: "a" })).toEqual([]);
  });

  it("adds and removes an upsell without touching the rest of quote_json", () => {
    const added = withUpsell({ pack_pieces: 2, upsell_ids: ["a"] }, "b", true);
    expect(added).toEqual({ pack_pieces: 2, upsell_ids: ["a", "b"], upsell_excluded_ids: [] });
    expect(withUpsell(added, "b", true).upsell_ids).toEqual(["a", "b"]);
    expect(withUpsell(added, "a", false)).toEqual({ pack_pieces: 2, upsell_ids: ["b"], upsell_excluded_ids: ["a"] });
  });

  it("maps a product to a composer line", () => {
    const item = composerItem({ id: "p", title: "Pochette", sku: "PO-1", photo_url: null, client_price: 0.45, weight_g: 18 }, 12);
    expect(item).toEqual({ id: "p", title: "Pochette", sku: "PO-1", photoUrl: null, price: 0.45, weightG: 18, stock: 12 });
    expect("stock" in composerItem({ id: "p", title: "x", sku: null, photo_url: null, client_price: null, weight_g: null })).toBe(false);
  });
});

describe("coPurchases", () => {
  it("counts the other SKUs of the orders that contain the main product", () => {
    const orders = [
      [{ sku: "TRAD", quantity: 1 }, { sku: "POUCH", quantity: 1, title: "Pochette" }],
      [{ sku: "trad ", quantity: 2 }, { sku: "POUCH", quantity: 2 }, { sku: "CASE", quantity: 1 }],
      [{ sku: "TRAD", quantity: 1 }],
      [{ sku: "POUCH", quantity: 1 }, { sku: "CASE", quantity: 1 }],
    ];
    const result = coPurchases(orders, new Set(["TRAD"]));
    expect(result.mainOrders).toBe(3);
    expect(result.items).toEqual([
      { sku: "POUCH", title: "Pochette", orders: 2, units: 3 },
      { sku: "CASE", title: null, orders: 1, units: 1 },
    ]);
  });
});

describe("automatic upsells (bought together)", () => {
  const price = (id: string) => ({ trad: 25, pouch: 4, case: 6, gift: null })[id] ?? null;

  it("makes the cheaper item of each order the upsell of the dearer one, from one sale", () => {
    const pairs = upsellPairs(
      [
        [{ productId: "trad", price: 29.9 }, { productId: "pouch", price: 5.9 }],
        [{ productId: "trad", price: 29.9 }, { productId: "pouch", price: 5.9 }, { productId: "case", price: 7.9 }],
        [{ productId: "trad", price: 29.9 }],
        [{ productId: "trad", price: 29.9 }, { productId: "gift", price: 0 }],
      ],
      price,
    );
    expect(Object.fromEntries(pairs.get("trad") ?? [])).toEqual({ pouch: 2, case: 1, gift: 1 });
    expect(Object.fromEntries(pairs.get("case") ?? [])).toEqual({ pouch: 1 });
    expect(pairs.get("pouch")).toBeUndefined();
  });

  it("falls back on the client price when the order has no price, no link on a tie", () => {
    const pairs = upsellPairs([[{ productId: "trad", price: null }, { productId: "pouch", price: null }]], price);
    expect(Object.fromEntries(pairs.get("trad") ?? [])).toEqual({ pouch: 1 });
    const tie = upsellPairs([[{ productId: "a", price: 10 }, { productId: "b", price: 10 }]], () => null);
    expect(tie.size).toBe(0);
  });

  it("adds new upsells on a light sync, recounts on the full one, keeps the old ones", () => {
    const existing = [{ id: "pouch", orders: 12 }];
    expect(mergeAutoUpsells(existing, new Map([["pouch", 1], ["case", 1]]), false)).toEqual([
      { id: "pouch", orders: 12 },
      { id: "case", orders: 1 },
    ]);
    expect(mergeAutoUpsells(existing, new Map([["case", 3]]), true)).toEqual([
      { id: "pouch", orders: 12 },
      { id: "case", orders: 3 },
    ]);
    expect(mergeAutoUpsells(existing, new Map([["pouch", 9]]), true)).toEqual([{ id: "pouch", orders: 9 }]);
  });

  it("lists hand links and detected ones, without the removed ones", () => {
    const quote = { upsell_ids: ["manual"], upsell_auto: [{ id: "case", orders: 1 }, { id: "pouch", orders: 5 }] };
    expect(parseAutoUpsells(quote).map((item) => item.id)).toEqual(["pouch", "case"]);
    expect(parseUpsellIds(quote)).toEqual(["manual", "pouch", "case"]);
    const removed = withUpsell(quote, "pouch", false);
    expect(removed.upsell_excluded_ids).toEqual(["pouch"]);
    expect(parseUpsellIds(removed)).toEqual(["manual", "case"]);
    // Linking it again by hand lifts the exclusion.
    expect(parseUpsellIds(withUpsell(removed, "pouch", true))).toEqual(["manual", "pouch", "case"]);
  });
});
