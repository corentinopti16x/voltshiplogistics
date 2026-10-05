import { describe, expect, it } from "vitest";
import { detectLanguage, extractReferences, matchOrder, type MatchableOrder } from "./match";

const orders: MatchableOrder[] = [
  { id: "o1", order_number: "1001", shopify_order_id: "1", placed_at: "2026-09-01T00:00:00Z", order_date: "2026-09-01", customer_key: "k-a", customer_email_key: "e-a" },
  { id: "o2", order_number: "1002", shopify_order_id: "2", placed_at: "2026-09-10T00:00:00Z", order_date: "2026-09-10", customer_key: "k-a", customer_email_key: "e-a" },
  { id: "o3", order_number: "1003", shopify_order_id: "3", placed_at: "2026-09-12T00:00:00Z", order_date: "2026-09-12", customer_key: "k-b", customer_email_key: "e-b" },
];

describe("extractReferences", () => {
  it("finds #numbers, worded numbers, VS references and tracking codes", () => {
    const refs = extractReferences(
      "Bonjour, ma commande #1002 n'est pas arrivée. Numéro de suivi YT2026123456789. Ref entrepôt VS-ACME-1002. Order no. 1003",
    );
    expect(refs.orderNumbers).toEqual(["1002", "1003"]);
    expect(refs.warehouseRefs).toEqual(["VS-ACME-1002"]);
    expect(refs.trackingNumbers).toEqual(["YT2026123456789"]);
  });
  it("ignores short or unrelated numbers", () => {
    const refs = extractReferences("J'ai payé 49 euros le 12 septembre");
    expect(refs.orderNumbers).toEqual([]);
    expect(refs.trackingNumbers).toEqual([]);
  });
});

describe("matchOrder", () => {
  it("prefers an explicit order number of the sender", () => {
    const result = matchOrder({ subject: "Commande #1001", body: "", senderEmailHash: "e-a", orders });
    expect(result.order?.id).toBe("o1");
    expect(result.by).toBe("number");
  });
  it("accepts an explicit number from an unknown sender", () => {
    const result = matchOrder({ subject: "", body: "order 1003 please", senderEmailHash: null, orders });
    expect(result.order?.id).toBe("o3");
  });
  it("falls back to the most recent order of the sender by e-mail hash", () => {
    const result = matchOrder({ subject: "Où est mon colis ?", body: "Merci", senderEmailHash: "e-a", orders });
    expect(result.order?.id).toBe("o2");
    expect(result.by).toBe("email");
  });
  it("matches customer_key hashes too and returns none otherwise", () => {
    expect(matchOrder({ subject: "", body: "", senderEmailHash: "k-b", orders }).order?.id).toBe("o3");
    expect(matchOrder({ subject: "", body: "", senderEmailHash: "nope", orders })).toMatchObject({ order: null, by: "none" });
  });
});

describe("detectLanguage", () => {
  it("detects FR vs EN", () => {
    expect(detectLanguage("Bonjour, je n'ai pas reçu ma commande, merci")).toBe("fr");
    expect(detectLanguage("Hello, where is my order? I have not received the parcel")).toBe("en");
  });
});
