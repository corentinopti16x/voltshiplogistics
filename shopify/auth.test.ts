import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = "test-secret";
  process.env.SHOPIFY_API_KEY = "test-key";
  process.env.SHOPIFY_SCOPES = "read_products, read_orders";
});

describe("normalizeShopDomain", () => {
  it("accepts bare handles, full domains and URLs", async () => {
    const { normalizeShopDomain } = await import("./auth");
    expect(normalizeShopDomain("mystore")).toBe("mystore.myshopify.com");
    expect(normalizeShopDomain("MyStore.myshopify.com")).toBe("mystore.myshopify.com");
    expect(normalizeShopDomain("https://mystore.myshopify.com/")).toBe("mystore.myshopify.com");
    expect(normalizeShopDomain("https://mystore.myshopify.com/admin?x=1")).toBe(
      "mystore.myshopify.com",
    );
  });
  it("rejects non-myshopify hosts", async () => {
    const { normalizeShopDomain } = await import("./auth");
    expect(normalizeShopDomain("evil.com")).toBeNull();
    expect(normalizeShopDomain("mystore.myshopify.com.evil.com")).toBeNull();
    expect(normalizeShopDomain("")).toBeNull();
  });
});

describe("OAuth state and authorize URL", () => {
  it("round-trips a signed state with returnTo and locale", async () => {
    const { createShopifyState, parseShopifyState } = await import("./auth");
    const state = createShopifyState({
      clientId: "c1",
      nonce: "n",
      exp: Date.now() + 1000,
      returnTo: "client",
      locale: "fr",
    });
    expect(parseShopifyState(state)).toMatchObject({ clientId: "c1", returnTo: "client", locale: "fr" });
    expect(parseShopifyState(`${state}x`)).toBeNull();
  });
  it("builds the authorize URL with the exact callback redirect", async () => {
    const { buildShopifyAuthorizeUrl } = await import("./auth");
    const url = new URL(
      buildShopifyAuthorizeUrl({
        shop: "mystore.myshopify.com",
        appUrl: "https://app.voltshiplogistics.com/",
        state: { clientId: "c1", returnTo: "admin", locale: "en" },
      }),
    );
    expect(url.origin + url.pathname).toBe("https://mystore.myshopify.com/admin/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-key");
    expect(url.searchParams.get("scope")).toBe("read_products,read_orders");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.voltshiplogistics.com/api/shopify/callback",
    );
    expect(url.searchParams.get("state")).toBeTruthy();
  });
});
