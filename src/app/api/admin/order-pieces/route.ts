import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadShopPieces } from "@/lib/products/variant-pieces-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Change = { shop: string; order: string; name: string | null; date: string; before: number; after: number; lines: string[] };

/**
 * Writes `pieces` on the lines of orders cached before the « pieces counted once » rule.
 * GET = preview only (list of orders whose number of pieces changes). POST = apply.
 * Touches shopify_orders_cache.line_items_json only: nothing else, no invoice.
 * ?client=<id> limits to one client; ?since=YYYY-MM-DD (default 120 days).
 */
async function run(request: Request, apply: boolean) {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "voltship_admin" || ctx.impersonating) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const url = new URL(request.url);
  const sinceParam = url.searchParams.get("since") ?? "";
  const since = /^\d{4}-\d{2}-\d{2}$/.test(sinceParam)
    ? sinceParam
    : new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
  const clientId = url.searchParams.get("client");
  const admin = createAdminClient();
  let shopsQuery = admin.from("shops").select("id, domain");
  if (clientId) shopsQuery = shopsQuery.eq("client_id", clientId);
  const { data: shops, error } = await shopsQuery;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const changes: Change[] = [];
  let scanned = 0;
  let written = 0;
  for (const shop of shops ?? []) {
    const pieces = await loadShopPieces(shop.id);
    for (let from = 0; from < 100_000; from += 1000) {
      const { data: rows, error: rowsError } = await admin
        .from("shopify_orders_cache")
        .select("id, shopify_order_id, order_date, line_items_json")
        .eq("shop_id", shop.id)
        .gte("order_date", since)
        .order("id")
        .range(from, from + 999);
      if (rowsError) return Response.json({ error: rowsError.message }, { status: 500 });
      for (const row of rows ?? []) {
        if (!Array.isArray(row.line_items_json)) continue;
        scanned += 1;
        let before = 0;
        let after = 0;
        let missing = false;
        let name: string | null = null;
        const detail: string[] = [];
        const next = (row.line_items_json as Array<Record<string, unknown>>).map((item) => {
          if (item && typeof item === "object" && "_order" in item) {
            const meta = item._order as { name?: unknown } | undefined;
            if (typeof meta?.name === "string") name = meta.name;
            return item;
          }
          const sku = typeof item?.sku === "string" ? item.sku.trim() : "";
          const qty = Math.max(0, Number(item?.quantity) || 0);
          if (!sku) return item;
          const key = sku.toLowerCase();
          const legacy = qty * (pieces.legacyBySku.get(key) ?? 1);
          const now = item.pieces != null && Number.isFinite(Number(item.pieces)) ? Number(item.pieces) : null;
          const computed = qty * (pieces.bySku.get(key) ?? 1);
          if (now == null) missing = true;
          before += now ?? legacy;
          after += now ?? computed;
          if ((now ?? legacy) !== (now ?? computed)) detail.push(`${qty} × ${sku} : ${legacy} → ${computed}`);
          return now == null ? { ...item, pieces: computed } : item;
        });
        if (before !== after) {
          changes.push({ shop: shop.domain, order: row.shopify_order_id, name, date: row.order_date, before, after, lines: detail });
        }
        if (apply && missing) {
          const { error: updateError } = await admin.from("shopify_orders_cache").update({ line_items_json: next }).eq("id", row.id);
          if (updateError) return Response.json({ error: updateError.message, written }, { status: 500 });
          written += 1;
        }
      }
      if (!rows || rows.length < 1000) break;
    }
  }
  changes.sort((a, b) => b.date.localeCompare(a.date));
  return Response.json({ since, scanned, changed: changes.length, applied: apply, written, changes });
}

export async function GET(request: Request) {
  return run(request, false);
}

export async function POST(request: Request) {
  return run(request, true);
}
