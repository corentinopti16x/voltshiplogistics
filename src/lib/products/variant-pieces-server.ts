import { createAdminClient } from "@/lib/supabase/admin";
import { packPieces } from "@/lib/products/extras";
import { needsSetCheck, variantPieces } from "@/lib/products/variant-pieces";

export type SkuPieces = { pieces: number; guessed: boolean; needsCheck: boolean; productId: string };

/** Key: `${clientId}|${sku lowercase}`. */
export type SkuPiecesMap = Map<string, SkuPieces>;

export const skuPiecesKey = (clientId: string, sku: string) => `${clientId}|${sku.trim().toLowerCase()}`;

/**
 * Pieces per sold variant, for every imported product of these clients (see variant-pieces.ts).
 * Empty map on error: callers fall back to the product's own « pieces per set ».
 */
export async function loadSkuPieces(clientIds: string[]): Promise<SkuPiecesMap> {
  const out: SkuPiecesMap = new Map();
  if (clientIds.length === 0) return out;
  const admin = createAdminClient();
  type Row = {
    client_id: string;
    imported_product_id: string | null;
    sku: string | null;
    variant_title: string | null;
    pack_units: number | null;
  };
  const rows: Row[] = [];
  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("shopify_products_cache")
        .select("client_id, imported_product_id, sku, variant_title, pack_units")
        .in("client_id", clientIds)
        .not("imported_product_id", "is", null)
        .order("id")
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
  } catch {
    return out;
  }
  const byProduct = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byProduct.get(row.imported_product_id!) ?? [];
    list.push(row);
    byProduct.set(row.imported_product_id!, list);
  }
  const ids = [...byProduct.keys()];
  const productPieces = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("products_cache").select("id, quote_json").in("id", ids.slice(i, i + 200));
    for (const p of (data ?? []) as Array<{ id: string; quote_json: unknown }>) {
      productPieces.set(p.id, packPieces(p.quote_json as Parameters<typeof packPieces>[0]));
    }
  }
  for (const [productId, list] of byProduct) {
    const pieces = variantPieces(
      list.map((r) => ({ sku: r.sku, variantTitle: r.variant_title, packUnits: r.pack_units })),
      productPieces.get(productId) ?? 1,
    );
    const check = needsSetCheck(pieces);
    const clientId = list[0].client_id;
    for (const row of pieces) {
      out.set(skuPiecesKey(clientId, row.sku), { pieces: row.pieces, guessed: row.guessed, needsCheck: check, productId });
    }
  }
  return out;
}

/** Pieces of every variant of one shop, by Shopify variant id and by SKU (lowercase). */
export type ShopPieces = {
  byVariant: Map<string, number>;
  bySku: Map<string, number>;
  /** Pieces the app used before 23/11/2026: the product's own « pieces per set », same for all variants. */
  legacyBySku: Map<string, number>;
};

export async function loadShopPieces(shopId: string): Promise<ShopPieces> {
  const out: ShopPieces = { byVariant: new Map(), bySku: new Map(), legacyBySku: new Map() };
  const admin = createAdminClient();
  type Row = {
    imported_product_id: string | null;
    shopify_variant_id: string;
    sku: string | null;
    variant_title: string | null;
    pack_units: number | null;
  };
  const rows: Row[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await admin
      .from("shopify_products_cache")
      .select("imported_product_id, shopify_variant_id, sku, variant_title, pack_units")
      .eq("shop_id", shopId)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  const byProduct = new Map<string, Row[]>();
  for (const row of rows) {
    const key = row.imported_product_id ?? `v:${row.shopify_variant_id}`;
    byProduct.set(key, [...(byProduct.get(key) ?? []), row]);
  }
  const ids = [...byProduct.keys()].filter((id) => !id.startsWith("v:"));
  const productPieces = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("products_cache").select("id, quote_json").in("id", ids.slice(i, i + 200));
    for (const p of (data ?? []) as Array<{ id: string; quote_json: unknown }>) {
      productPieces.set(p.id, packPieces(p.quote_json as Parameters<typeof packPieces>[0]));
    }
  }
  for (const [productId, list] of byProduct) {
    const pieces = variantPieces(
      list.map((r) => ({ sku: r.sku ?? `variant-${r.shopify_variant_id}`, variantTitle: r.variant_title, packUnits: r.pack_units })),
      productPieces.get(productId) ?? 1,
    );
    pieces.forEach((row, index) => {
      const source = list[index];
      out.byVariant.set(String(source.shopify_variant_id), row.pieces);
      if (source.sku) {
        out.bySku.set(source.sku.trim().toLowerCase(), row.pieces);
        out.legacyBySku.set(source.sku.trim().toLowerCase(), productPieces.get(productId) ?? 1);
      }
    });
  }
  return out;
}
