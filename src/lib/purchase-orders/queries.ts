import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { PurchaseOrderHistoryEntry } from "@/lib/purchase-orders/core";

/** Client-safe columns (never notes_internal). */
const CLIENT_COLUMNS =
  "id, client_id, product_id, reference, title, quantity, unit_price_eur, total_eur, status, eta, tracking, notes_client, history, paid_at, received_at, created_at, updated_at";

export type PurchaseOrderRow = {
  id: string;
  client_id: string;
  product_id: string | null;
  reference: string;
  title: string;
  quantity: number;
  unit_price_eur: number | null;
  total_eur: number | null;
  status: string;
  eta: string | null;
  tracking: string | null;
  notes_client: string | null;
  history: PurchaseOrderHistoryEntry[] | null;
  paid_at: string | null;
  received_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminPurchaseOrderRow = PurchaseOrderRow & { notes_internal: string | null; client_name: string };

function isMissingTable(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "42P01" || /purchase_orders/.test(error.message ?? "")));
}

export async function listClientPurchaseOrders(
  clientId: string,
  options: { productId?: string; openOnly?: boolean; limit?: number } = {},
): Promise<PurchaseOrderRow[]> {
  const admin = createAdminClient();
  let query = admin.from("purchase_orders").select(CLIENT_COLUMNS).eq("client_id", clientId);
  if (options.productId) query = query.eq("product_id", options.productId);
  if (options.openOnly) query = query.not("status", "in", "(received,cancelled)");
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 100)
    .returns<PurchaseOrderRow[]>();
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return data ?? [];
}

export async function countOpenPurchaseOrders(clientId: string) {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("purchase_orders")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .not("status", "in", "(received,cancelled)");
  if (error) return 0;
  return count ?? 0;
}

/** Voltship admin: every order (with internal notes). */
export async function listAllPurchaseOrders(options: { clientId?: string; openOnly?: boolean } = {}) {
  const admin = createAdminClient();
  let query = admin.from("purchase_orders").select(`${CLIENT_COLUMNS}, notes_internal, clients!inner(name)`);
  if (options.clientId) query = query.eq("client_id", options.clientId);
  if (options.openOnly) query = query.not("status", "in", "(received,cancelled)");
  const { data, error } = await query.order("created_at", { ascending: false }).limit(300);
  if (error) {
    if (isMissingTable(error)) return { rows: [] as AdminPurchaseOrderRow[], missingTable: true };
    throw error;
  }
  const rows = (data ?? []).map((row) => {
    const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
    const { clients: _clients, ...rest } = row as typeof row & { clients: unknown };
    void _clients;
    return { ...(rest as unknown as PurchaseOrderRow), notes_internal: row.notes_internal, client_name: (client as { name?: string } | null)?.name ?? "?" };
  });
  return { rows: rows as AdminPurchaseOrderRow[], missingTable: false };
}

export type RestockRequest = {
  key: string;
  clientId: string;
  clientName: string;
  productId: string;
  productTitle: string;
  qty: number | null;
  notes: string;
  at: string;
};

/** Restock requests clients sent from the app (last 90 days) not yet turned into an order. */
export async function listPendingRestockRequests(): Promise<RestockRequest[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("products_cache")
    .select("id, client_id, title, quote_json, clients!inner(name)")
    .not("quote_json->_restocks", "is", null)
    .limit(500);
  const since = Date.now() - 90 * 86400000;
  const out: RestockRequest[] = [];
  for (const product of data ?? []) {
    const quote = (product.quote_json ?? {}) as Record<string, unknown>;
    const restocks = Array.isArray(quote._restocks) ? (quote._restocks as Array<Record<string, unknown>>) : [];
    const client = Array.isArray(product.clients) ? product.clients[0] : product.clients;
    for (const entry of restocks) {
      const at = String(entry.at ?? "");
      if (!at || Date.parse(at) < since || entry.purchase_order_id) continue;
      out.push({
        key: `${product.id}:${at}`,
        clientId: product.client_id,
        clientName: (client as { name?: string } | null)?.name ?? "?",
        productId: product.id,
        productTitle: product.title,
        qty: entry.qty == null ? null : Number(entry.qty),
        notes: String(entry.notes ?? ""),
        at,
      });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
