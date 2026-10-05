import { describe, expect, it } from "vitest";
import { buildDraftPrompt, normalizeDraftOutput, signatureFor } from "./draft";

const order = {
  number: "1002",
  placedAt: "2026-09-10T00:00:00Z",
  status: "shipped" as const,
  carrier: "YunExpress",
  service: "YE_CHC",
  trackingNumber: "YT2026123456789",
  trackingUrl: "https://www.yuntrack.com/parcelTracking?id=YT2026123456789",
  shippedAt: "2026-09-12T00:00:00Z",
  eta: "6–10 jours",
  items: [{ sku: "LAMP-01", title: "Lampe nuage", qty: 1 }],
};

describe("buildDraftPrompt", () => {
  it("builds a French prompt with the order facts and the store signature", () => {
    const prompt = buildDraftPrompt({
      storeName: "Maison Lune",
      customerName: "Jane",
      subject: "Commande #1002",
      message: "Bonjour, où est ma commande ? Merci",
      order,
    });
    expect(prompt.language).toBe("fr");
    expect(prompt.signature).toBe("L'équipe Maison Lune");
    expect(prompt.system).toContain("NEVER invent a tracking number");
    expect(prompt.system).toContain('"L\'équipe Maison Lune"');
    expect(prompt.user).toContain("Matched order: #1002");
    expect(prompt.user).toContain("Tracking URL: https://www.yuntrack.com/parcelTracking?id=YT2026123456789");
    expect(prompt.user).toContain("Delivery estimate after shipping: 6–10 jours");
    expect(prompt.user).toContain("1× Lampe nuage");
  });
  it("asks for the order number when nothing matched, in English", () => {
    const prompt = buildDraftPrompt({
      storeName: "Moon House",
      customerName: null,
      subject: "Where is my parcel",
      message: "Hello, I have not received my order yet. Thanks",
      order: null,
    });
    expect(prompt.language).toBe("en");
    expect(prompt.user).toContain("Matched order: NONE");
    expect(prompt.system).toContain("ask the customer for their order number");
    expect(signatureFor("Moon House", "en")).toBe("The Moon House team");
  });
});

describe("normalizeDraftOutput", () => {
  it("validates intent, clamps confidence and appends the signature", () => {
    const out = normalizeDraftOutput(
      { intent: "where_is_my_order", confidence: 1.4, language: "fr", reply: "Bonjour Jane, votre colis est en route." },
      { language: "fr", signature: "L'équipe Maison Lune", trackingNumber: "YT2026123456789" },
    );
    expect(out).toEqual({
      intent: "where_is_my_order",
      confidence: 1,
      language: "fr",
      reply: "Bonjour Jane, votre colis est en route.\n\nL'équipe Maison Lune",
    });
  });
  it("drops invented tracking codes when the order has none and defaults the intent", () => {
    const out = normalizeDraftOutput(
      { intent: "nope", reply: "Your tracking number is YT9999888877776. Thanks.\n\nThe Moon House team" },
      { language: "en", signature: "The Moon House team", trackingNumber: null },
    );
    expect(out?.intent).toBe("other");
    expect(out?.confidence).toBe(0.5);
    expect(out?.reply).not.toContain("YT9999888877776");
    expect(out?.reply).toContain("[…]");
    expect(normalizeDraftOutput({ reply: "" }, { language: "en", signature: "x", trackingNumber: null })).toBeNull();
  });
});
