import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptShopifyToken } from "./crypto";

export type ShopifyAppCredentials = { apiKey: string; apiSecret: string; perStore: boolean };

/** Global (env) app — the fallback when a store has no dedicated custom app. */
export function globalShopifyAppCredentials(): ShopifyAppCredentials | null {
  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  return apiKey && apiSecret ? { apiKey, apiSecret, perStore: false } : null;
}

/** Credentials of the Shopify app used for this store (per-store custom app, else global). */
export async function shopifyAppCredentialsFor(shop: string): Promise<ShopifyAppCredentials> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("shopify_app_credentials")
    .select("api_key, api_secret_encrypted")
    .eq("shopify_domain", shop.toLowerCase())
    .maybeSingle();
  if (data) {
    return {
      apiKey: data.api_key,
      apiSecret: decryptShopifyToken(data.api_secret_encrypted),
      perStore: true,
    };
  }
  const global = globalShopifyAppCredentials();
  if (!global) throw new Error("Shopify app credentials are not configured.");
  return global;
}
