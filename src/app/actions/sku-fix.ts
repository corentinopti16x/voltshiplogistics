"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { applySkuFixes } from "@/lib/shopify/sku-fix";

/**
 * « Corriger les SKU » → « Écrire dans Shopify »: writes the ticked SKUs on the client stores.
 * Admin only (never while impersonating a client).
 */
export async function applySkuFixAction(formData: FormData): Promise<void> {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "voltship_admin" || ctx.impersonating) throw new Error("Admin access required.");
  const locale = ["fr", "en", "zh"].includes(String(formData.get("locale"))) ? String(formData.get("locale")) : "fr";
  const picks = formData
    .getAll("pick")
    .map((value) => String(value))
    .filter(Boolean)
    .map((key) => ({ key, sku: String(formData.get(`sku_${key}`) ?? "") }));
  const result = await applySkuFixes(picks);
  revalidateTag("admin-todo", "max");
  revalidatePath("/[locale]/admin/skus", "page");
  revalidatePath("/[locale]/admin/todo", "page");
  revalidatePath("/[locale]/sourcer", "page");
  const params = new URLSearchParams({ done: String(result.written), failed: String(result.failed.length) });
  const client = String(formData.get("client") ?? "");
  if (client) params.set("client", client);
  if (formData.get("all") === "1") params.set("all", "1");
  if (result.failed.length) params.set("errors", result.failed.slice(0, 5).map((f) => `${f.title} : ${f.error}`).join(" | ").slice(0, 900));
  redirect(`/${locale}/admin/skus?${params.toString()}`);
}
