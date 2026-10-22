"use server";

import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateProductCogsMatrix } from "@/lib/pricing/server";
import type { ProductRow } from "@/lib/products/types";
import type { ShippingChannel } from "@/lib/domain/pricing";

/** Draft values typed on the sourcing form, not saved yet. */
export type SourcingPreviewInput = {
  productId: string;
  clientPrice: string;
  weightG: string;
  channel: string;
  boxPriceRmb: string;
  boxWeightG: string;
  packagingWeightG: string;
  packPieces: string;
};

export type SourcingPreviewCell = {
  quantity: number;
  cogs: number;
  product: number;
  box: number;
  shipping: number;
  /** Préparation + commission, as shown on the product page. */
  handling: number;
  weightG: number;
  lineName: string | null;
};

export type SourcingPreviewResult = {
  ok: boolean;
  missing?: "product_data" | "grid" | null;
  markets: { destination: string; cells: (SourcingPreviewCell | null)[] }[];
};

const PREVIEW_QUANTITIES = [1, 2, 3] as const;

function num(raw: string): number | null {
  const text = String(raw ?? "").trim().replace(",", ".");
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Live COGS of the sourcing form: same engine as the saved matrix, run on the values
 * being typed (nothing is written). Lets the sourcer see the COGS move while filling in.
 */
export async function previewSourcingCogsAction(input: SourcingPreviewInput): Promise<SourcingPreviewResult> {
  const ctx = await getAuthContext();
  if (!ctx || (ctx.role !== "sourcer" && ctx.role !== "voltship_admin")) {
    return { ok: false, markets: [] };
  }
  const admin = createAdminClient();
  const { data } = await admin.from("products_cache").select("*").eq("id", input.productId).maybeSingle();
  if (!data) return { ok: false, markets: [] };
  const product = data as ProductRow;

  const pieces = num(input.packPieces);
  const draft: ProductRow = {
    ...product,
    client_price: num(input.clientPrice),
    weight_g: num(input.weightG),
    shipping_channel: (input.channel || null) as ProductRow["shipping_channel"],
    quote_json: {
      ...(product.quote_json ?? {}),
      box_price_rmb: num(input.boxPriceRmb),
      box_weight_g: num(input.boxWeightG),
      packaging_weight_g: num(input.packagingWeightG),
      pack_pieces: pieces != null && Number.isInteger(pieces) && pieces >= 1 ? pieces : 1,
    },
  };

  try {
    const matrix = await calculateProductCogsMatrix(draft, {
      quantities: PREVIEW_QUANTITIES,
      overrides: { channel: (input.channel || null) as ShippingChannel | null },
    });
    return {
      ok: true,
      missing: matrix.missingReason,
      markets: matrix.markets.map((market) => ({
        destination: market.destination,
        cells: market.cells.map((cell) =>
          cell.breakdown
            ? {
                quantity: cell.quantity,
                cogs: cell.breakdown.cogs,
                product: cell.breakdown.product,
                box: cell.breakdown.box ?? 0,
                shipping: cell.breakdown.shipping,
                handling: cell.breakdown.handling + cell.breakdown.commission,
                weightG: cell.breakdown.weightG,
                lineName: cell.breakdown.lineName,
              }
            : null,
        ),
      })),
    };
  } catch {
    return { ok: false, markets: [] };
  }
}
