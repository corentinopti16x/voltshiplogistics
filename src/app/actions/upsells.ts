"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { CLIENT_PRODUCT_SELECT, serializeClientProduct } from "@/lib/products/visibility";
import type { ProductRow } from "@/lib/products/types";
import { parseUpsellIds, withUpsell } from "@/lib/products/upsells";
import { refreshAutoUpsells } from "@/lib/products/upsells-server";
import { calculateComposedCogs } from "@/lib/pricing/server";
import type { BundleBreakdown } from "@/lib/domain/pricing";

async function loadProducts(ids: string[]) {
  const admin = createAdminClient();
  const { data } = await admin.from("products_cache").select(CLIENT_PRODUCT_SELECT).in("id", ids);
  return (data ?? []).map((row) => serializeClientProduct(row as Record<string, unknown>));
}

/** Staff (sourcer / Voltship admin): link or unlink an upsell to a product of the same client. */
export async function toggleUpsellAction(formData: FormData): Promise<void> {
  const ctx = await getAuthContext();
  if (!ctx || (ctx.role !== "sourcer" && ctx.role !== "voltship_admin")) throw new Error("Sourcer access required.");
  const productId = String(formData.get("product_id") ?? "");
  const upsellId = String(formData.get("upsell_id") ?? "");
  const add = formData.get("op") !== "remove";
  if (!productId || !upsellId || productId === upsellId) throw new Error("Choose an upsell.");
  const [main, upsell] = await Promise.all([loadProducts([productId]), loadProducts([upsellId])]).then(([a, b]) => [a[0], b[0]]);
  if (!main || !upsell || main.client_id !== upsell.client_id) throw new Error("The upsell must be a product of the same client.");
  const admin = createAdminClient();
  const { data: raw } = await admin.from("products_cache").select("quote_json").eq("id", productId).maybeSingle();
  const quote = (raw?.quote_json as Record<string, unknown> | null) ?? {};
  const { error } = await admin
    .from("products_cache")
    .update({ quote_json: withUpsell(quote, upsellId, add) })
    .eq("id", productId)
    .eq("client_id", main.client_id);
  if (error) throw new Error(error.message);
  revalidatePath("/[locale]/sourcer/[id]", "page");
  revalidatePath("/[locale]/sourcer/products", "page");
  revalidatePath("/[locale]/products/[id]", "page");
}

/** Staff: detect the upsells again from the last 90 days of orders (one client, or all). */
export async function refreshUpsellsAction(formData: FormData): Promise<void> {
  const ctx = await getAuthContext();
  if (!ctx || (ctx.role !== "sourcer" && ctx.role !== "voltship_admin")) throw new Error("Sourcer access required.");
  const clientId = String(formData.get("client_id") ?? "");
  const admin = createAdminClient();
  let clientIds = clientId ? [clientId] : [];
  if (!clientId) {
    const { data } = await admin.from("shops").select("client_id").eq("status", "active");
    clientIds = [...new Set((data ?? []).map((row) => String(row.client_id)))];
  }
  for (const id of clientIds) await refreshAutoUpsells(id, { days: 90 });
  revalidatePath("/[locale]/sourcer/[id]", "page");
  revalidatePath("/[locale]/sourcer/products", "page");
  revalidatePath("/[locale]/products/[id]", "page");
}

export type ComposeResult = { ok: boolean; error?: string; breakdown?: BundleBreakdown | null; missingReason?: string | null };

/**
 * COGS of a parcel main product + chosen upsells. The client of the product (or Voltship
 * staff) only; quantities 0–20, only upsells linked to the product.
 */
export async function composeCogsAction(
  productId: string,
  market: string,
  selections: Array<{ productId: string; quantity: number }>,
): Promise<ComposeResult> {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const [main] = await loadProducts([productId]);
  if (!main) return { ok: false, error: "Product not found." };
  const staff = ctx.role === "sourcer" || ctx.role === "voltship_admin";
  if (!staff && ctx.clientId !== main.client_id) return { ok: false, error: "Product not found." };
  const allowed = new Set([main.id, ...parseUpsellIds(main.quote_json)]);
  const wanted = selections
    .filter((item) => allowed.has(item.productId))
    .map((item) => ({ productId: item.productId, quantity: Math.min(20, Math.max(0, Math.round(Number(item.quantity) || 0))) }))
    .filter((item) => item.quantity > 0);
  const products = await loadProducts([...new Set(wanted.map((item) => item.productId))]);
  const byId = new Map<string, ProductRow>(products.filter((row) => row.client_id === main.client_id).map((row) => [row.id, row]));
  const lines = wanted
    .map((item) => ({ product: byId.get(item.productId), quantity: item.quantity }))
    .filter((line): line is { product: ProductRow; quantity: number } => !!line.product);
  if (lines.length === 0) return { ok: true, breakdown: null, missingReason: null };
  const result = await calculateComposedCogs(main, lines, market);
  return { ok: true, breakdown: result.breakdown, missingReason: result.missingReason };
}
