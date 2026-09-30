import { getAuthContext } from "@/lib/auth/context";
import { connectInstalledShopifyShop } from "@/lib/shopify/admin-api";
import { normalizeShopDomain } from "@/lib/shopify/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const ctx = await getAuthContext();
  const url = new URL(request.url);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || url.origin).replace(/\/$/, "");
  const back = (query: string) => Response.redirect(`${appUrl}/admin/shops?${query}`);
  if (!ctx || ctx.role !== "voltship_admin") {
    return Response.redirect(`${appUrl}/staff/login`);
  }
  const clientId = url.searchParams.get("client_id") ?? "";
  const shop = normalizeShopDomain(url.searchParams.get("shop") ?? "");
  if (!clientId || !shop) {
    return back("error=A%20client%20and%20a%20valid%20myshopify.com%20domain%20are%20required.");
  }
  const admin = createAdminClient();
  const { data: client } = await admin
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return back("error=Client%20not%20found.");

  try {
    const result = await connectInstalledShopifyShop({ clientId, shop, appUrl });
    if (result.syncError) {
      return back(`connected=1&error=${encodeURIComponent(result.syncError)}`);
    }
    return back("connected=1");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify connection failed.";
    return back(`error=${encodeURIComponent(message)}`);
  }
}
