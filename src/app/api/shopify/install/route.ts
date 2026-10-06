import {
  buildShopifyAuthorizeUrl,
  normalizeShopDomain,
  verifyShopifyQueryHmac,
} from "@/lib/shopify/auth";
import { shopifyAppCredentialsFor } from "@/lib/shopify/app-credentials";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Landing point after a merchant installs a store's custom app from its install link
 * (Shopify opens the App URL with ?shop=…&hmac=…). The store's app was registered by
 * Voltship with the client it belongs to, so the OAuth grant starts for that client
 * without the merchant having to sign in to Voltship first.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || url.origin).replace(/\/$/, "");
  const fail = (message: string) =>
    Response.redirect(`${appUrl}/fr/login?error=${encodeURIComponent(message)}`);

  const shop = normalizeShopDomain(url.searchParams.get("shop") ?? "");
  if (!shop) return fail("Boutique Shopify invalide.");

  let apiKey: string;
  let apiSecret: string;
  try {
    ({ apiKey, apiSecret } = await shopifyAppCredentialsFor(shop));
  } catch {
    return fail("Cette boutique n'est pas encore configurée chez Voltship.");
  }
  if (!verifyShopifyQueryHmac(url.searchParams, apiSecret)) {
    return fail("Signature Shopify invalide.");
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("shopify_app_credentials")
    .select("client_id")
    .eq("shopify_domain", shop)
    .maybeSingle();
  const clientId = (data as { client_id?: string | null } | null)?.client_id ?? null;
  if (!clientId) {
    return fail("Cette boutique n'est rattachée à aucun client Voltship. Contacte Voltship.");
  }

  const authorizeUrl = buildShopifyAuthorizeUrl({
    shop,
    appUrl,
    apiKey,
    state: { clientId, returnTo: "client", locale: "fr" },
  });
  return Response.redirect(authorizeUrl, 302);
}
