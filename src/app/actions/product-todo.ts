"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  importShopifyVariantGroup,
  reconcileClientProducts,
  type ShopifyCacheVariant,
} from "@/lib/shopify/import-product";
import { refreshClientEffectiveSkus } from "@/lib/shopify/sku-resolve";

async function requireAdmin() {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "voltship_admin") throw new Error("Admin access required.");
  return ctx;
}

function localeOf(formData: FormData) {
  const locale = String(formData.get("locale") ?? "fr");
  return ["fr", "en", "zh"].includes(locale) ? locale : "fr";
}

async function loadVariants(shopId: string, shopifyProductId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("shopify_products_cache")
    .select("id, client_id, shop_id, shopify_product_id, title, sku, photo_url, clients!inner(name, airtable_client_record_id)")
    .eq("shop_id", shopId)
    .eq("shopify_product_id", shopifyProductId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    ...row,
    clients: Array.isArray(row.clients) ? row.clients[0] : row.clients,
  })) as ShopifyCacheVariant[];
}

function revalidateTodo() {
  revalidateTag("admin-todo", "max");
  revalidatePath("/[locale]/admin/todo", "page");
  revalidatePath("/[locale]/admin", "layout");
  revalidatePath("/[locale]/sourcer", "page");
}

/** "Créer la fiche": one Voltship product for this Shopify product, then open it to fill it. */
export async function createProductFromShopifyAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const shopId = String(formData.get("shop_id") ?? "");
  const shopifyProductId = String(formData.get("shopify_product_id") ?? "");
  const variants = await loadVariants(shopId, shopifyProductId);
  if (variants.length === 0) throw new Error("Produit Shopify introuvable.");
  const result = await importShopifyVariantGroup(variants);
  if (!result.ok) throw new Error(result.error);
  revalidateTodo();
  redirect(`/${localeOf(formData)}/sourcer/${result.productId}?from=todo`);
}

/**
 * "Relier à un produit déjà coté": the client created the product on Shopify himself
 * after we quoted it — map every variant SKU to the quoted Voltship product.
 */
export async function linkShopifyProductAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const shopId = String(formData.get("shop_id") ?? "");
  const shopifyProductId = String(formData.get("shopify_product_id") ?? "");
  const productId = String(formData.get("product_id") ?? "");
  if (!productId) throw new Error("Choisis le produit Voltship à relier.");
  const admin = createAdminClient();
  const [variants, { data: product }] = await Promise.all([
    loadVariants(shopId, shopifyProductId),
    admin.from("products_cache").select("id, client_id, sku, airtable_record_id").eq("id", productId).maybeSingle(),
  ]);
  if (!product || variants.length === 0) throw new Error("Produit introuvable.");
  if (variants.some((variant) => variant.client_id !== product.client_id)) {
    throw new Error("Ce produit appartient à un autre client.");
  }
  for (const variant of variants) {
    await admin
      .from("shopify_products_cache")
      .update({ imported_product_id: product.id })
      .eq("id", variant.id)
      .eq("client_id", variant.client_id);
    if (variant.sku) {
      await admin.from("sku_maps").upsert(
        {
          client_id: variant.client_id,
          shop_id: variant.shop_id,
          shopify_sku: variant.sku,
          airtable_record_id: product.airtable_record_id,
        },
        { onConflict: "client_id,shop_id,shopify_sku" },
      );
    }
  }
  // The whole item follows: every Shopify page (other shops, duplicates) of the product it
  // was on moves to the chosen product; the product created automatically is then archived.
  const fromProductId = String(formData.get("from_product_id") ?? "");
  if (fromProductId && fromProductId !== product.id) {
    const { data: from } = await admin
      .from("products_cache")
      .select("id, client_id, airtable_record_id")
      .eq("id", fromProductId)
      .maybeSingle();
    if (from && from.client_id === product.client_id) {
      await admin
        .from("shopify_products_cache")
        .update({ imported_product_id: product.id })
        .eq("client_id", product.client_id)
        .eq("imported_product_id", from.id);
      await admin
        .from("sku_maps")
        .update({ airtable_record_id: product.airtable_record_id })
        .eq("client_id", product.client_id)
        .eq("airtable_record_id", from.airtable_record_id);
    }
  }
  const firstSku = variants.find((variant) => variant.sku)?.sku ?? null;
  if (!product.sku && firstSku) {
    await admin.from("products_cache").update({ sku: firstSku }).eq("id", product.id);
  }
  await reconcileClientProducts({ clientId: product.client_id }).catch(() => null);
  revalidateTodo();
  revalidatePath(`/[locale]/products/${product.id}`, "page");
}

/**
 * "Séparer": this Shopify page is a different item that only shares the SKU of the others.
 * It gets its own Voltship SKU (orders, sales and warehouse included) and its own product.
 */
export async function splitShopifyListingAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const shopId = String(formData.get("shop_id") ?? "");
  const shopifyProductId = String(formData.get("shopify_product_id") ?? "");
  const variants = await loadVariants(shopId, shopifyProductId);
  if (variants.length === 0) throw new Error("Produit Shopify introuvable.");
  const clientId = variants[0].client_id;
  const admin = createAdminClient();
  const { error } = await admin
    .from("shopify_products_cache")
    .update({ sku_split: true, imported_product_id: null })
    .eq("shop_id", shopId)
    .eq("shopify_product_id", shopifyProductId)
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
  await refreshClientEffectiveSkus(clientId);
  await reconcileClientProducts({ clientId });
  revalidateTodo();
}
