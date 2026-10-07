import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { OrderAlertMessageRow, OrderAlertRow } from "@/lib/orders/alerts-server";

export type OrderAlertView = OrderAlertRow & {
  clientName: string | null;
  messages: OrderAlertMessageRow[];
};

/** Open alerts first (newest order first), then the resolved ones. Empty before migration 00017. */
export async function listOrderAlerts(options: {
  clientId?: string | null;
  status?: "open" | "all";
  limit?: number;
}): Promise<OrderAlertView[]> {
  const admin = createAdminClient();
  let query = admin
    .from("order_alerts")
    .select(
      "id, client_id, shop_id, shopify_order_id, order_number, placed_at, reasons, details, status, resolved_at, created_at",
    )
    .order("placed_at", { ascending: false })
    .limit(options.limit ?? 60);
  if (options.clientId) query = query.eq("client_id", options.clientId);
  if (options.status === "open") query = query.eq("status", "open");
  const { data, error } = await query.returns<OrderAlertRow[]>();
  if (error || !data || data.length === 0) return [];

  const ids = data.map((row) => row.id);
  const clientIds = [...new Set(data.map((row) => row.client_id))];
  const [{ data: messages }, { data: clients }] = await Promise.all([
    admin
      .from("order_alert_messages")
      .select("id, alert_id, author_role, body, created_at")
      .in("alert_id", ids)
      .order("created_at", { ascending: true })
      .returns<OrderAlertMessageRow[]>(),
    admin.from("clients").select("id, name").in("id", clientIds),
  ]);
  const byAlert = new Map<string, OrderAlertMessageRow[]>();
  for (const message of messages ?? []) {
    const list = byAlert.get(message.alert_id) ?? [];
    list.push(message);
    byAlert.set(message.alert_id, list);
  }
  const names = new Map((clients ?? []).map((client) => [client.id, client.name as string]));
  const views = data.map((row) => ({
    ...row,
    clientName: names.get(row.client_id) ?? null,
    messages: byAlert.get(row.id) ?? [],
  }));
  return [...views.filter((row) => row.status === "open"), ...views.filter((row) => row.status !== "open")];
}

export async function countOpenOrderAlerts(clientId?: string | null) {
  const admin = createAdminClient();
  let query = admin.from("order_alerts").select("id", { count: "exact", head: true }).eq("status", "open");
  if (clientId) query = query.eq("client_id", clientId);
  const { count, error } = await query;
  return error ? 0 : (count ?? 0);
}

/** Whether the client has ever had an alert (shows the menu entry). */
export async function hasOrderAlerts(clientId: string) {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("order_alerts")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  return !error && (count ?? 0) > 0;
}
