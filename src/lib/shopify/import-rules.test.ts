import { describe, expect, it } from "vitest";
import { refreshedShopifyPhoto, soldRecently } from "./import-rules";

describe("soldRecently", () => {
  it("is true as soon as one variant sold over 90 days", () => {
    expect(soldRecently([{ units_90d: 0 }, { units_90d: 3 }])).toBe(true);
    expect(soldRecently([{ units_90d: 0 }, { units_90d: null }, {}])).toBe(false);
    expect(soldRecently([])).toBe(false);
  });
});

describe("refreshedShopifyPhoto", () => {
  const old = "https://cdn.shopify.com/s/files/1/old.jpg?v=1";
  const fresh = "https://cdn.shopify.com/s/files/1/new.jpg?v=2";
  it("replaces a Shopify photo no listing uses any more by the best seller's", () => {
    expect(refreshedShopifyPhoto(old, [{ photo_url: "https://cdn.shopify.com/x.jpg", units_90d: 1 }, { photo_url: fresh, units_90d: 9 }])).toBe(fresh);
    expect(refreshedShopifyPhoto(null, [{ photo_url: fresh }])).toBe(fresh);
  });
  it("keeps a photo still in use, a photo uploaded by the team, or when no listing has one", () => {
    expect(refreshedShopifyPhoto(old, [{ photo_url: old }, { photo_url: fresh }])).toBeNull();
    expect(refreshedShopifyPhoto("https://x.supabase.co/storage/p.jpg", [{ photo_url: fresh }])).toBeNull();
    expect(refreshedShopifyPhoto(old, [{ photo_url: null }])).toBeNull();
  });
});
