import { parseShopifyState, normalizeShopDomain, verifyShopifyQueryHmac } from "@/lib/shopify/auth";
import {
  backfillShopifyOrders,
  exchangeShopifyCode,
  registerShopifyWebhooks,
  syncShopifyProducts,
} from "@/lib/shopify/admin-api";
import { encryptShopifyToken } from "@/lib/shopify/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!verifyShopifyQueryHmac(url.searchParams)) {
    return Response.json({ error: "Invalid Shopify signature." }, { status: 401 });
  }
  const shop = normalizeShopDomain(url.searchParams.get("shop") ?? "");
  const code = url.searchParams.get("code");
  const state = parseShopifyState(url.searchParams.get("state") ?? "");
  if (!shop || !code || !state) {
    return Response.json({ error: "Invalid Shopify callback." }, { status: 400 });
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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;
    try {
      await registerShopifyWebhooks(shop, token.access_token, appUrl);
    } catch {
      // Existing webhook registrations can return a duplicate error; sync still proceeds.
    }
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
    await admin
      .from("shops")
      .update({ last_synced_at: new Date().toISOString(), sync_error: null })
      .eq("id", saved.id);

    return Response.redirect(`${appUrl.replace(/\/$/, "")}/admin/shops?connected=1`);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Shopify connection failed." },
      { status: 500 },
    );
  }
}
