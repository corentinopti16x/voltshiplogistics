import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/server";
import { carrierLineLabel, parseCarrierPreferences } from "@/lib/domain/carrier-rules";
import { lineKey, normalizeDestination } from "@/lib/domain/pricing";

/**
 * After a grid activation: every product whose `_carrier_pref` names a line that no longer
 * exists in the new grid (carrier + line absent for that market and channel) gets an
 * in-app notification for its tenant. Nothing is rewritten — the engine already falls
 * back to the cheapest allowed line at compute time. Best-effort, never throws.
 */
export async function notifyUnavailableCarrierLines(gridVersion: string) {
  const admin = createAdminClient();
  try {
    const [{ data: cells }, { data: products }] = await Promise.all([
      admin.from("rate_grid_cells").select("carrier, line_name, destination, channel").eq("grid_version", gridVersion),
      admin
        .from("products_cache")
        .select("id, client_id, title, shipping_channel, quote_json")
        .not("quote_json->_carrier_pref", "is", null),
    ]);
    const available = new Set(
      (cells ?? []).map(
        (cell) =>
          `${cell.destination.trim().toUpperCase()}|${cell.channel}|${lineKey(cell.carrier, cell.line_name || null)}`,
      ),
    );
    const clientIds = [...new Set((products ?? []).map((product) => product.client_id as string))];
    const languages = new Map<string, string>();
    if (clientIds.length > 0) {
      const { data: clients } = await admin.from("clients").select("id, language").in("id", clientIds);
      for (const client of clients ?? []) languages.set(client.id, client.language ?? "fr");
    }

    let notified = 0;
    for (const product of products ?? []) {
      if (!product.shipping_channel) continue;
      const preferences = parseCarrierPreferences(product.quote_json);
      for (const [market, ref] of Object.entries(preferences)) {
        const key = `${normalizeDestination(market)}|${product.shipping_channel}|${lineKey(ref.carrier, ref.lineName)}`;
        if (available.has(key)) continue;
        const line = carrierLineLabel(ref);
        const message =
          languages.get(product.client_id) === "en"
            ? `${product.title}: the line ${line} chosen for ${market} is no longer in the rate grid — the cheapest line is applied until you pick another one.`
            : `${product.title} : la ligne ${line} choisie pour ${market} n'existe plus dans la grille tarifaire — le moins cher est appliqué tant que vous n'en choisissez pas une autre.`;
        try {
          await createNotification({
            clientId: product.client_id,
            type: "carrier_line_unavailable",
            payload: {
              productId: product.id,
              productTitle: product.title,
              market,
              carrier: ref.carrier,
              lineName: ref.lineName,
              gridVersion,
              message,
            },
          });
          notified += 1;
        } catch {
          // Best-effort: the activation already succeeded.
        }
      }
    }
    return { notified };
  } catch {
    return { notified: 0 };
  }
}
