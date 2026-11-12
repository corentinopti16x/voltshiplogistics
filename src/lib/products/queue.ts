import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { QueueItem } from "./queue-core";
import { isShopifyImport } from "./sales90";

/** Statuses of a product whose quote has not been sent yet (same as the « to quote » filter). */
export const TO_QUOTE_STATUSES = ["brief_received", "factories", "samples", "negotiation"];

/**
 * Products still to quote, oldest first: the order of the Sourcing list. Shopify pages
 * imported automatically that sold nothing in 90 days are left out, as in the list.
 */
export async function loadQuoteQueue(): Promise<QueueItem[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("products_cache")
    .select("id, title, migration_state")
    .in("sourcing_status", TO_QUOTE_STATUSES)
    .order("created_at", { ascending: true })
    .limit(2000);
  const rows = (data ?? []) as Array<{ id: string; title: string; migration_state: string | null }>;
  const imports = rows.filter((row) => isShopifyImport(row.migration_state)).map((row) => row.id);
  const selling = new Set<string>();
  for (let index = 0; index < imports.length; index += 200) {
    const { data: sold } = await admin
      .from("shopify_products_cache")
      .select("imported_product_id")
      .in("imported_product_id", imports.slice(index, index + 200))
      .gt("units_90d", 0);
    for (const row of (sold ?? []) as Array<{ imported_product_id: string | null }>) {
      if (row.imported_product_id) selling.add(row.imported_product_id);
    }
  }
  return rows
    .filter((row) => !isShopifyImport(row.migration_state) || selling.has(row.id))
    .map((row) => ({ id: row.id, title: row.title }));
}
