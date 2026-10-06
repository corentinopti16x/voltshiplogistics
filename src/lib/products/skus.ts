import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type SkuProduct = {
  id: string;
  client_id: string;
  sku: string | null;
  airtable_record_id: string;
};

/**
 * Every Shopify SKU that belongs to each product: its own `sku` plus all variant SKUs
 * mapped to it in `sku_maps` (a product imported from Shopify maps one SKU per variant).
 */
export async function loadProductSkus(products: SkuProduct[]) {
  const result = new Map<string, string[]>();
  for (const product of products) result.set(product.id, product.sku ? [product.sku] : []);
  const recordIds = [...new Set(products.map((product) => product.airtable_record_id))];
  if (recordIds.length === 0) return result;
  const admin = createAdminClient();
  const byRecord = new Map<string, Array<{ client_id: string; shopify_sku: string }>>();
  for (let i = 0; i < recordIds.length; i += 200) {
    const { data } = await admin
      .from("sku_maps")
      .select("client_id, shopify_sku, airtable_record_id")
      .in("airtable_record_id", recordIds.slice(i, i + 200));
    for (const row of data ?? []) {
      const list = byRecord.get(row.airtable_record_id) ?? [];
      list.push({ client_id: row.client_id, shopify_sku: row.shopify_sku });
      byRecord.set(row.airtable_record_id, list);
    }
  }
  for (const product of products) {
    const mapped = (byRecord.get(product.airtable_record_id) ?? [])
      .filter((row) => row.client_id === product.client_id)
      .map((row) => row.shopify_sku);
    result.set(product.id, [...new Set([...(result.get(product.id) ?? []), ...mapped])]);
  }
  return result;
}
