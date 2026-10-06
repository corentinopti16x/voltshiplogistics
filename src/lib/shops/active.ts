import "server-only";

import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export const ACTIVE_SHOP_COOKIE = "vs_shop";

export type ClientShop = { id: string; domain: string; label: string };

/** Connected Shopify stores of a client, labelled with the name given in the admin. */
export async function listClientShops(clientId: string): Promise<ClientShop[]> {
  const admin = createAdminClient();
  const { data: shops } = await admin
    .from("shops")
    .select("id, shopify_domain, status")
    .eq("client_id", clientId)
    .neq("status", "disconnected")
    .order("created_at", { ascending: true });
  const domains = (shops ?? []).map((shop) => shop.shopify_domain);
  const labels = new Map<string, string>();
  if (domains.length > 0) {
    const { data } = await admin
      .from("shopify_app_credentials")
      .select("shopify_domain, label")
      .in("shopify_domain", domains);
    for (const row of data ?? []) if (row.label) labels.set(row.shopify_domain, row.label);
  }
  return (shops ?? []).map((shop) => ({
    id: shop.id,
    domain: shop.shopify_domain,
    label: labels.get(shop.shopify_domain) ?? shop.shopify_domain.replace(/\.myshopify\.com$/, ""),
  }));
}

/** The store the client is looking at, or null for "all stores". */
export async function getActiveShopId(clientId: string): Promise<string | null> {
  const value = (await cookies()).get(ACTIVE_SHOP_COOKIE)?.value;
  if (!value || value === "all") return null;
  const shops = await listClientShops(clientId);
  return shops.some((shop) => shop.id === value) ? value : null;
}
