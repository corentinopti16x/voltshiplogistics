import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { InboundStatus } from "@/lib/eccang/mapping";

export type InboundRow = {
  id: string;
  reference_no: string | null;
  eccang_asn_code: string | null;
  eccang_ref: string | null;
  status: InboundStatus | "quarantined";
  eccang_status: string | null;
  cancelled: boolean;
  qty_announced: number | null;
  qty_received: number | null;
  items_json: Array<{ sku: string; qty: number; received: number; putaway: number }> | null;
  tracking_no: string | null;
  eta: string | null;
  expected_at: string | null;
  received_at: string | null;
  putaway_at: string | null;
  product_id: string | null;
  updated_at: string;
};

export type EccangOrderRow = {
  id: string;
  reference_no: string;
  eccang_order_code: string | null;
  status: string;
  tracking_no: string | null;
  carrier_code: string | null;
  shipping_method: string | null;
  billed_weight_g: number | null;
  error: string | null;
  pushed_at: string | null;
  shipped_at: string | null;
  created_at: string;
  /** "external" = created by the client in ECCANG (own API key), not pushed from Shopify. */
  source?: string | null;
  external_ref?: string | null;
};

/** Cheap flag read used by client pages to switch "Stock déclaré" ↔ "Stock entrepôt". */
export async function isClientEccangEnabled(clientId: string) {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("clients")
      .select("eccang_enabled, eccang_warehouse_code")
      .eq("id", clientId)
      .maybeSingle();
    return Boolean(data?.eccang_enabled && data?.eccang_warehouse_code);
  } catch {
    return false;
  }
}

export async function listInbound(clientId: string, limit = 50): Promise<InboundRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("inbound_cache")
    .select(
      "id, reference_no, eccang_asn_code, eccang_ref, status, eccang_status, cancelled, qty_announced, qty_received, items_json, tracking_no, eta, expected_at, received_at, putaway_at, product_id, updated_at",
    )
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(limit)
    .returns<InboundRow[]>();
  if (error) throw error;
  return data ?? [];
}

export async function listRecentEccangOrders(clientId: string, limit = 8): Promise<EccangOrderRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("eccang_orders")
    .select(
      "id, reference_no, eccang_order_code, status, tracking_no, carrier_code, shipping_method, billed_weight_g, error, pushed_at, shipped_at, created_at, source, external_ref",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<EccangOrderRow[]>();
  if (error) throw error;
  return data ?? [];
}

/** Orders pushed more than `hours` ago that still have no tracking (admin attention). */
export async function listStuckEccangOrders(hours = 48, limit = 10) {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
  const { data } = await admin
    .from("eccang_orders")
    .select("id, client_id, reference_no, status, pushed_at, clients!inner(name)")
    .is("tracking_no", null)
    .not("eccang_order_code", "is", null)
    .not("status", "in", "(D,X)")
    .lt("pushed_at", cutoff)
    .order("pushed_at", { ascending: true })
    .limit(limit)
    .returns<
      Array<{
        id: string;
        client_id: string;
        reference_no: string;
        status: string;
        pushed_at: string;
        clients: { name: string } | { name: string }[] | null;
      }>
    >();
  return data ?? [];
}

/** A public tracking page link when we can guess one from the carrier, else null. */
export function trackingUrl(trackingNo: string | null, carrier: string | null) {
  if (!trackingNo) return null;
  const c = (carrier ?? "").toLowerCase();
  if (c.includes("yun") || c.includes("云途")) return `https://www.yuntrack.com/parcelTracking?id=${encodeURIComponent(trackingNo)}`;
  if (c.includes("4px")) return `https://track.4px.com/#/result/0/${encodeURIComponent(trackingNo)}`;
  if (c.includes("colissimo") || c.includes("la poste")) return `https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(trackingNo)}`;
  return `https://www.17track.net/en/track?nums=${encodeURIComponent(trackingNo)}`;
}
