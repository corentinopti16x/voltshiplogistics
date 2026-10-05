import { getAuthContext } from "@/lib/auth/context";
import { connectInstalledShopifyShop } from "@/lib/shopify/admin-api";
import {
  buildShopifyAuthorizeUrl,
  localePathPrefix,
  normalizeShopDomain,
  type OAuthLocale,
} from "@/lib/shopify/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const MAX_SHOPS_PER_CLIENT = 10;

/**
 * Starts the Shopify OAuth flow ("Connect my store").
 *
 * GET /api/shopify/connect?shop=<domain>&from=client|admin[&client_id=…][&locale=fr|en][&mode=installed]
 *
 * Only redirects to Shopify's consent screen: nothing is mutated before the
 * signed callback, and the state carries a nonce + 10-minute expiry.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || url.origin).replace(/\/$/, "");
  const from = url.searchParams.get("from") === "client" ? "client" : "admin";
  const localeParam = url.searchParams.get("locale");
  const locale: OAuthLocale = localeParam === "fr" ? "fr" : "en";
  const backPath =
    from === "client" ? `${localePathPrefix(locale)}/settings` : "/admin/shops";
  const back = (query: string) => Response.redirect(`${appUrl}${backPath}?${query}`);
  const fail = (message: string) => back(`error=${encodeURIComponent(message)}`);

  const ctx = await getAuthContext();
  if (!ctx) {
    return Response.redirect(
      from === "client" ? `${appUrl}${localePathPrefix(locale)}/login` : `${appUrl}/staff/login`,
    );
  }

  let clientId: string | null = null;
  if (from === "admin") {
    if (ctx.role !== "voltship_admin") return Response.redirect(`${appUrl}/staff/login`);
    clientId = url.searchParams.get("client_id") || null;
    if (!clientId) return fail("A client is required.");
  } else {
    if (ctx.role === "staff") return fail("Only the company owner can connect a Shopify store.");
    clientId = ctx.clientId;
    if (!clientId) return fail("Not signed in to a workspace.");
  }

  const shop = normalizeShopDomain(url.searchParams.get("shop") ?? "");
  if (!shop) return fail("Enter a valid myshopify.com domain (e.g. mystore.myshopify.com).");

  const admin = createAdminClient();
  const { data: client } = await admin.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return fail("Client not found.");

  const { data: existing } = await admin
    .from("shops")
    .select("id, shopify_domain")
    .eq("client_id", clientId);
  const alreadyLinked = (existing ?? []).some((row) => row.shopify_domain === shop);
  if (!alreadyLinked && (existing ?? []).length >= MAX_SHOPS_PER_CLIENT) {
    return fail(`A client can connect at most ${MAX_SHOPS_PER_CLIENT} Shopify stores.`);
  }

  // Legacy path: custom app already installed on the store (client_credentials grant).
  if (url.searchParams.get("mode") === "installed" && from === "admin") {
    try {
      const result = await connectInstalledShopifyShop({ clientId, shop, appUrl });
      if (result.syncError) {
        return back(`connected=1&error=${encodeURIComponent(result.syncError)}`);
      }
      return back("connected=1");
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Shopify connection failed.");
    }
  }

  try {
    const authorizeUrl = buildShopifyAuthorizeUrl({
      shop,
      appUrl,
      state: { clientId, returnTo: from, locale },
    });
    return Response.redirect(authorizeUrl, 302);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Shopify is not configured.");
  }
}
