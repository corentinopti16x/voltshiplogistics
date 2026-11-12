import { createAdminClient } from "@/lib/supabase/admin";
import {
  PRICE_CHANGE_ACTION,
  latestPriceChanges,
  type PriceChange,
} from "./price-changes-core";

/** Keeps, for each product whose price moved, the price before and after and the date. */
export async function recordPriceChanges(
  userId: string,
  market: string,
  products: Array<{
    id: string;
    clientId: string;
    before: number | null;
    after: number | null;
  }>,
) {
  const rows = products
    .filter(
      (product) =>
        product.before != null &&
        product.after != null &&
        Math.abs(product.after - product.before) >= 0.005,
    )
    .map((product) => ({
      actor_user_id: userId,
      client_id: product.clientId,
      action: PRICE_CHANGE_ACTION,
      entity: product.id,
      diff_json: { market, before: product.before, after: product.after },
    }));
  const admin = createAdminClient();
  for (let index = 0; index < rows.length; index += 200) {
    await admin.from("audit_log").insert(rows.slice(index, index + 200));
  }
}

/** Price changes of one client over the last `days` days, newest first. */
export async function loadRecentPriceChanges(
  clientId: string,
  days = 60,
): Promise<PriceChange[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await createAdminClient()
    .from("audit_log")
    .select("entity, diff_json, created_at")
    .eq("action", PRICE_CHANGE_ACTION)
    .eq("client_id", clientId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return [];
  return latestPriceChanges(
    (data ?? []) as Array<{ entity: string | null; diff_json: unknown; created_at: string }>,
  );
}
