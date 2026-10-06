"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth/context";
import { ACTIVE_SHOP_COOKIE, listClientShops } from "@/lib/shops/active";

export async function setActiveShopAction(formData: FormData): Promise<void> {
  const ctx = await getAuthContext();
  if (!ctx?.clientId) return;
  const value = String(formData.get("shop") ?? "all");
  const shops = await listClientShops(ctx.clientId);
  const next = shops.some((shop) => shop.id === value) ? value : "all";
  (await cookies()).set(ACTIVE_SHOP_COOKIE, next, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
