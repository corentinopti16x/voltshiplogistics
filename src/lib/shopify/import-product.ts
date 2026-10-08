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
  options: { auto?: boolean } = {},
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
  // Automatic imports (every sync) stay out of Airtable: it is only a mirror and a store
  // can have hundreds of products.
  if (!options.auto && getAirtableConfig().configured) {
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
    // Auto-imported products start as "testing": the lifecycle classifier then promotes
    // them from their real Shopify sales (a manual import means "this one sells").
    lifecycle_status: options.auto ? "testing" : "winning",
    sourcing_status: "validated",
    migration_state: options.auto ? "imported_auto" : "imported_pending",
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

/**
 * Every active Shopify product of a shop becomes a Voltship product, so the client sees his
 * whole catalogue as soon as the store is connected and Voltship completes the sheets from
 * "À compléter". A Shopify product whose SKU already belongs to a Voltship product (quoted
 * before the client created it on Shopify) is linked to it instead of duplicated.
 */
export async function autoImportShopProducts(input: { clientId: string; shopId: string; limit?: number }) {
  const admin = createAdminClient();
  const { data: cache, error } = await admin
    .from("shopify_products_cache")
    .select("id, client_id, shop_id, shopify_product_id, title, sku, photo_url, status, imported_product_id")
    .eq("shop_id", input.shopId)
    .eq("client_id", input.clientId)
    .limit(10000);
  if (error) throw error;
  const rows = (cache ?? []).filter((row) => !row.status || row.status === "active");
  // Shopify products where at least one variant is already linked are left alone.
  const linkedProducts = new Set(rows.filter((row) => row.imported_product_id).map((row) => row.shopify_product_id));
  const groups = new Map<string, ShopifyCacheVariant[]>();
  for (const row of rows) {
    if (row.imported_product_id || linkedProducts.has(row.shopify_product_id)) continue;
    groups.set(row.shopify_product_id, [...(groups.get(row.shopify_product_id) ?? []), row as ShopifyCacheVariant]);
  }
  if (groups.size === 0) return { created: 0, linked: 0 };

  // SKUs already owned by a Voltship product of this client (own SKU or sku_maps).
  const [{ data: products }, { data: maps }] = await Promise.all([
    admin.from("products_cache").select("id, sku, airtable_record_id").eq("client_id", input.clientId).limit(10000),
    admin.from("sku_maps").select("shopify_sku, airtable_record_id").eq("client_id", input.clientId).limit(20000),
  ]);
  const byRecord = new Map((products ?? []).map((product) => [product.airtable_record_id, product]));
  const owner = new Map<string, { id: string; airtable_record_id: string }>();
  for (const product of products ?? []) if (product.sku) owner.set(product.sku.trim().toLowerCase(), product);
  for (const map of maps ?? []) {
    const product = byRecord.get(map.airtable_record_id);
    if (product) owner.set(map.shopify_sku.trim().toLowerCase(), product);
  }

  let created = 0;
  let linked = 0;
  for (const variants of [...groups.values()].slice(0, input.limit ?? 80)) {
    const match = variants
      .map((variant) => (variant.sku ? owner.get(variant.sku.trim().toLowerCase()) : undefined))
      .find(Boolean);
    if (match) {
      for (const variant of variants) {
        await admin
          .from("shopify_products_cache")
          .update({ imported_product_id: match.id })
          .eq("id", variant.id)
          .eq("client_id", variant.client_id);
        if (variant.sku) {
          await admin.from("sku_maps").upsert(
            {
              client_id: variant.client_id,
              shop_id: variant.shop_id,
              shopify_sku: variant.sku,
              airtable_record_id: match.airtable_record_id,
            },
            { onConflict: "client_id,shop_id,shopify_sku" },
          );
        }
      }
      linked += 1;
      continue;
    }
    const result = await importShopifyVariantGroup(variants, { auto: true });
    if (result.ok) created += 1;
  }
  return { created, linked };
}
