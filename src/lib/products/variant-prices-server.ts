import { createAdminClient } from "@/lib/supabase/admin";
import { calculateProductCogsMatrix } from "@/lib/pricing/server";
import type { ProductRow } from "@/lib/products/types";
import { sourcingDecision, type SourcingDecision } from "@/lib/products/decision";
import { variantUnits } from "@/lib/products/variant-units";

export type VariantPriceRow = {
  /** Cache rows behind this line: variants with the same number of pieces and the same price. */
  ids: string[];
  /** Variant names, as stored (« Pieces: 24 »). */
  labels: string[];
  units: number;
  /** True when the number of pieces was read in the name, false when the team set it. */
  guessed: boolean;
  /** Shopify selling price of the variant, in the shop's currency. */
  price: number | null;
  cogs: number | null;
  shipping: number | null;
  weightG: number | null;
  decision: SourcingDecision;
};

export type VariantPriceMarket = { destination: string; rows: VariantPriceRow[] };

const MAX_LINES = 12;

/**
 * Landed cost and verdict for each Shopify variant of a product, when its variants are not
 * all « 1 piece at one price » (lots of 10 / 24 / 55, packs of 2 / 4…). Null otherwise, or
 * when the variant names and prices are not stored yet (migration 00026, then a Shopify sync).
 */
export async function loadVariantPrices(product: ProductRow): Promise<VariantPriceMarket[] | null> {
  const { data, error } = await createAdminClient()
    .from("shopify_products_cache")
    .select("id, variant_title, price, pack_units")
    .eq("imported_product_id", product.id)
    .order("price", { ascending: true });
  if (error || !data || data.length === 0) return null;

  const groups = new Map<string, Omit<VariantPriceRow, "cogs" | "shipping" | "weightG" | "decision">>();
  for (const row of data as Array<{
    id: string;
    variant_title: string | null;
    price: number | string | null;
    pack_units: number | null;
  }>) {
    const { units, guessed } = variantUnits(row);
    const price = row.price == null ? null : Number(row.price);
    const key = `${units}|${price ?? ""}`;
    const group = groups.get(key) ?? { ids: [], labels: [], units, guessed: false, price };
    group.ids.push(row.id);
    if (guessed) group.guessed = true;
    const label = (row.variant_title ?? "").trim();
    if (label && !group.labels.includes(label)) group.labels.push(label);
    groups.set(key, group);
  }
  const lines = [...groups.values()].sort((a, b) => a.units - b.units || (a.price ?? 0) - (b.price ?? 0));
  const worthShowing = lines.length > 1 || lines.some((line) => line.units > 1);
  if (!worthShowing) return null;
  const shown = lines.slice(0, MAX_LINES);

  const quantities = [...new Set(shown.map((line) => line.units))];
  const matrix = await calculateProductCogsMatrix(product, { quantities }).catch(() => null);
  if (!matrix) return null;
  return matrix.markets.map((market) => ({
    destination: market.destination,
    rows: shown.map((line) => {
      const breakdown = market.cells.find((cell) => cell.quantity === line.units)?.breakdown ?? null;
      return {
        ...line,
        cogs: breakdown?.cogs ?? null,
        shipping: breakdown?.shipping ?? null,
        weightG: breakdown?.weightG ?? null,
        decision: sourcingDecision({
          sellingPrice: line.price,
          cogs: breakdown?.cogs,
          shipping: breakdown?.shipping,
          weightG: breakdown?.weightG,
        }),
      };
    }),
  }));
}
