import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { productSkuKeys, sevenDayTrends, type SalesProduct, type SalesTrend, type SalesVariant } from "@/lib/products/sales90";

type DailyRow = { client_id: string; sku: string; date: string; units_sold: number | null };

/**
 * 7-day sales trend of products (last 7 days vs the 7 before), read from the daily sales
 * cache of their clients. Shared by the sourcing queue, the catalogue and the product sheet
 * so the sourcer sees what sells while filling in. `variants` are the client's Shopify
 * variants (already loaded by the page) used to map SKUs to products.
 */
export async function loadSevenDayTrends(
  products: SalesProduct[],
  variants: SalesVariant[],
): Promise<Map<string, SalesTrend>> {
  const clientIds = [...new Set(products.map((product) => product.client_id))];
  if (clientIds.length === 0) return new Map();
  const admin = createAdminClient();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 13 * 86_400_000).toISOString().slice(0, 10);
  const daily: DailyRow[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data: page } = await admin
      .from("sales_cache")
      .select("client_id, sku, date, units_sold")
      .in("client_id", clientIds)
      .gte("date", since)
      .order("id")
      .range(from, from + 999);
    daily.push(...((page ?? []) as DailyRow[]));
    if (!page || page.length < 1000) break;
  }
  return sevenDayTrends(products, productSkuKeys(products, variants), daily, today);
}

/** Shopify variants of one client (SKU → product mapping + 90-day units). */
export async function loadClientSalesVariants(clientId: string): Promise<SalesVariant[]> {
  const admin = createAdminClient();
  const variants: SalesVariant[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data: page } = await admin
      .from("shopify_products_cache")
      .select("id, client_id, sku, units_90d, imported_product_id")
      .eq("client_id", clientId)
      .order("id")
      .range(from, from + 999);
    variants.push(...((page ?? []) as SalesVariant[]));
    if (!page || page.length < 1000) break;
  }
  return variants;
}
