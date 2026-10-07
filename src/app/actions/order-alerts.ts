"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/auth/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/server";
import { applyOrderReview } from "@/lib/orders/alerts-server";
import type { ActionResult } from "@/app/actions/admin";

type AlertAccess = {
  alert: { id: string; client_id: string; shop_id: string; shopify_order_id: string; order_number: string | null; status: string };
  userId: string;
  role: "client" | "voltship";
};

/** Voltship admins reach every alert; client users only their own client's. */
async function loadAlertAccess(alertId: string): Promise<AlertAccess | { error: string }> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "Connecte-toi d'abord." };
  if (!alertId) return { error: "Alerte introuvable." };
  const admin = createAdminClient();
  const { data: alert } = await admin
    .from("order_alerts")
    .select("id, client_id, shop_id, shopify_order_id, order_number, status")
    .eq("id", alertId)
    .maybeSingle();
  if (!alert) return { error: "Alerte introuvable." };
  if (ctx.role === "voltship_admin") return { alert, userId: ctx.userId, role: "voltship" };
  if ((ctx.role === "owner" || ctx.role === "staff") && ctx.clientId === alert.client_id) {
    return { alert, userId: ctx.userId, role: "client" };
  }
  return { error: "Accès refusé." };
}

function revalidateAlerts() {
  revalidatePath("/[locale]/alerts", "page");
  revalidatePath("/[locale]/admin/alerts", "page");
  revalidatePath("/[locale]/dashboard", "page");
}

export async function postOrderAlertMessageAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const access = await loadAlertAccess(String(formData.get("alert_id") ?? ""));
  if ("error" in access) return { ok: false, error: access.error };
  const body = String(formData.get("body") ?? "").trim();
  if (body.length < 2) return { ok: false, error: "Écris un message." };
  if (body.length > 2000) return { ok: false, error: "Message trop long (2 000 caractères max)." };

  const admin = createAdminClient();
  const { error } = await admin.from("order_alert_messages").insert({
    alert_id: access.alert.id,
    client_id: access.alert.client_id,
    author_user_id: access.userId,
    author_role: access.role,
    body,
  });
  if (error) return { ok: false, error: error.message };

  if (access.role === "voltship") {
    const number = access.alert.order_number ? `#${access.alert.order_number}` : "une commande";
    await createNotification({
      clientId: access.alert.client_id,
      type: "order_alert",
      channels: ["in_app"],
      payload: {
        alertId: access.alert.id,
        href: "/alerts",
        message: `Voltship a répondu sur la commande à vérifier ${number}`,
      },
    }).catch(() => undefined);
  }
  revalidateAlerts();
  return { ok: true };
}

export async function resolveOrderAlertAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const access = await loadAlertAccess(String(formData.get("alert_id") ?? ""));
  if ("error" in access) return { ok: false, error: access.error };
  const decision = String(formData.get("decision") ?? "");
  if (decision !== "legit" && decision !== "abuse" && decision !== "open") {
    return { ok: false, error: "Décision inconnue." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("order_alerts")
    .update({
      status: decision,
      resolved_by: decision === "open" ? null : access.userId,
      resolved_at: decision === "open" ? null : new Date().toISOString(),
    })
    .eq("id", access.alert.id);
  if (error) return { ok: false, error: error.message };

  // Reopening keeps the last decision on the order until a new one is taken.
  if (decision !== "open") await applyOrderReview(admin, access.alert, decision);

  const who = access.role === "voltship" ? "Voltship" : "Le client";
  const text =
    decision === "legit"
      ? `${who} a validé : vraie commande, comptée dans les ventes.`
      : decision === "abuse"
        ? `${who} a confirmé l'abus : commande sortie des ventes.`
        : `${who} a rouvert l'alerte.`;
  await admin.from("order_alert_messages").insert({
    alert_id: access.alert.id,
    client_id: access.alert.client_id,
    author_user_id: access.userId,
    author_role: "system",
    body: text,
  });
  await writeAudit({
    actorUserId: access.userId,
    clientId: access.alert.client_id,
    action: "order_alert.resolve",
    entity: "order_alerts",
    diff: { alert_id: access.alert.id, from: access.alert.status, to: decision },
  });
  revalidateAlerts();
  return { ok: true };
}
