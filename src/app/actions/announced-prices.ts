"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeDestination, parseAnnouncedPrices } from "@/lib/domain/pricing";

/**
 * « Prix annoncés » : total per parcel (product + transport + handling) promised to the
 * client for this product, market and quantity. Empty field = the palier rule applies.
 */
export async function saveAnnouncedPricesAction(formData: FormData): Promise<void> {
  const ctx = await getAuthContext();
  if (!ctx || (ctx.role !== "sourcer" && ctx.role !== "voltship_admin")) {
    throw new Error("Sourcer access required.");
  }
  const productId = String(formData.get("product_id") ?? "");
  const market = normalizeDestination(String(formData.get("market") ?? ""), "");
  if (!productId || !/^[A-Z]{2}$/.test(market)) throw new Error("Choisis un pays.");
  const admin = createAdminClient();
  const { data: product } = await admin.from("products_cache").select("id, quote_json").eq("id", productId).maybeSingle();
  if (!product) throw new Error("Produit introuvable.");
  const quote = (product.quote_json && typeof product.quote_json === "object" ? product.quote_json : {}) as Record<
    string,
    unknown
  >;
  const prices = parseAnnouncedPrices(quote.announced_prices);
  const byQty: Record<string, number> = {};
  for (let quantity = 1; quantity <= 5; quantity += 1) {
    const raw = String(formData.get(`q${quantity}`) ?? "").replace(",", ".").trim();
    const value = Number(raw);
    if (raw && Number.isFinite(value) && value > 0) byQty[String(quantity)] = Math.round(value * 100) / 100;
  }
  if (Object.keys(byQty).length > 0) prices[market] = byQty;
  else delete prices[market];
  const { error } = await admin
    .from("products_cache")
    .update({ quote_json: { ...quote, announced_prices: prices } })
    .eq("id", productId);
  if (error) throw new Error(error.message);
  revalidatePath("/[locale]/sourcer/[id]", "page");
  revalidatePath("/[locale]/admin/margin", "layout");
  revalidatePath(`/[locale]/products/${productId}`, "page");
}
