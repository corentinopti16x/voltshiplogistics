import "server-only";

import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAirtableConfig } from "@/lib/airtable/config";
import { createAirtableProduct } from "@/lib/airtable/products";

export type ShopifyCacheVariant = {
  id: string;
  client_id: string;
  shop_id: string;
  shopify_product_id: string;
  title: string;
  sku: string | null;
  photo_url: string | null;
  clients?: { name?: string | null; airtable_client_record_id?: string | null } | null;
};

/**
 * One Voltship product (status "à compléter") from all variants of one Shopify product;
 * every variant SKU is mapped to it (sku_maps) and the cache rows point to it.
 */
export async function importShopifyVariantGroup(
  variants: ShopifyCacheVariant[],
): Promise<{ ok: true; productId: string } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const row = variants[0];
  const id = randomUUID();
  const request = {
    description: `Imported from Shopify product ${row.shopify_product_id} (${variants.length} variant(s)).`,
    destination_markets: "FR",
    notes: "Winning-product migration. Sourcer backfill required.",
  };
  let airtableRecordId = `pending:${id}`;
  if (getAirtableConfig().configured) {
    try {
      const record = await createAirtableProduct({
        clientId: row.client_id,
        clientName: row.clients?.name,
        airtableClientRecordId: row.clients?.airtable_client_record_id,
        title: row.title,
        photoUrl: row.photo_url,
        request,
      });
      airtableRecordId = record.id;
    } catch (airtableError) {
      return {
        ok: false as const,
        error:
          airtableError instanceof Error
            ? airtableError.message
            : "Could not create migrated Airtable product.",
      };
    }
  }

  const { error: insertError } = await admin.from("products_cache").insert({
    id,
    client_id: row.client_id,
    airtable_record_id: airtableRecordId,
    sku: variants.find((v) => v.sku)?.sku ?? null,
    title: row.title,
    photo_url: variants.find((v) => v.photo_url)?.photo_url ?? null,
    created_date: new Date().toISOString().slice(0, 10),
    lifecycle_status: "winning",
    sourcing_status: "validated",
    migration_state: "imported_pending",
    quote_json: {
      _request: request,
      _sync: {
        status: airtableRecordId.startsWith("pending:") ? "pending" : "synced",
      },
    },
  });
  if (insertError) return { ok: false as const, error: insertError.message };
  for (const variant of variants) {
    await admin
      .from("shopify_products_cache")
      .update({ imported_product_id: id })
      .eq("id", variant.id)
      .eq("client_id", variant.client_id);
    if (variant.sku) {
      await admin.from("sku_maps").upsert(
        {
          client_id: variant.client_id,
          shop_id: variant.shop_id,
          shopify_sku: variant.sku,
          airtable_record_id: airtableRecordId,
        },
        { onConflict: "client_id,shop_id,shopify_sku" },
      );
    }
  }
  return { ok: true, productId: id };
}
