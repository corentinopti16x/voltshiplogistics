import {
  localePathPrefix,
  normalizeShopDomain,
  parseShopifyState,
  verifyShopifyQueryHmac,
  type OAuthState,
} from "@/lib/shopify/auth";
import {
  backfillShopifyOrders,
  exchangeShopifyCode,
  registerShopifyWebhooks,
  syncShopifyProducts,
} from "@/lib/shopify/admin-api";
import { encryptShopifyToken } from "@/lib/shopify/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

function returnPath(state: Pick<OAuthState, "returnTo" | "locale"> | null) {
  if (state?.returnTo === "client") return `${localePathPrefix(state.locale)}/settings`;
  return "/admin/shops";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || url.origin).replace(/\/$/, "");
  // State is parsed first so that even error redirects land on the right page.
  // An invalid/expired state falls back to the admin page.
  const rawState = url.searchParams.get("state") ?? "";
  const state = parseShopifyState(rawState);
  const base = `${appUrl}${returnPath(state)}`;
  const fail = (message: string) =>
    Response.redirect(`${base}?error=${encodeURIComponent(message)}`);

  if (!verifyShopifyQueryHmac(url.searchParams)) {
    return fail("Invalid Shopify signature.");
  }
  const shop = normalizeShopDomain(url.searchParams.get("shop") ?? "");
  const code = url.searchParams.get("code");
  if (!shop || !code || !state) {
    return fail("Invalid or expired Shopify callback. Please start the connection again.");
  }

  try {
    const token = await exchangeShopifyCode(shop, code);
    const admin = createAdminClient();
    const { data: saved, error } = await admin
      .from("shops")
      .upsert(
        {
          client_id: state.clientId,
          shopify_domain: shop,
          access_token_encrypted: encryptShopifyToken(token.access_token),
          scopes: token.scope,
          status: "active",
          sync_error: null,
        },
        { onConflict: "client_id,shopify_domain" },
      )
      .select("id")
      .single();
    if (error || !saved) throw error ?? new Error("Could not save Shopify shop.");

    try {
      await registerShopifyWebhooks(shop, token.access_token, appUrl);
    } catch {
      // Existing webhook registrations can return a duplicate error; sync still proceeds.
    }

    let syncError: string | null = null;
    try {
      await backfillShopifyOrders({
        clientId: state.clientId,
        shopId: saved.id,
        shop,
        accessToken: token.access_token,
      });
      await syncShopifyProducts({
        clientId: state.clientId,
        shopId: saved.id,
        shop,
        accessToken: token.access_token,
      });
    } catch (syncFailure) {
      syncError = syncFailure instanceof Error ? syncFailure.message : "Initial sync failed.";
    }
    await admin
      .from("shops")
      .update({ last_synced_at: new Date().toISOString(), sync_error: syncError })
      .eq("id", saved.id);

    return Response.redirect(
      syncError ? `${base}?connected=1&error=${encodeURIComponent(syncError)}` : `${base}?connected=1`,
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Shopify connection failed.");
  }
}
