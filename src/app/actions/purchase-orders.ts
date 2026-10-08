"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/server";
import {
  appendHistory,
  isPurchaseOrderStatus,
  purchaseOrderReference,
  purchaseOrderTotal,
  type PurchaseOrderStatus,
} from "@/lib/purchase-orders/core";

export type PurchaseOrderActionResult = { ok: boolean; error?: string };

const STATUS_FR: Record<PurchaseOrderStatus, string> = {
  to_pay: "en attente de paiement",
  in_production: "en production",
  quality_check: "en contrôle qualité",
  to_warehouse: "en route vers l'entrepôt",
  received: "reçue à l'entrepôt",
  cancelled: "annulée",
};

async function requireAdmin() {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "voltship_admin") return null;
  return ctx;
}

function num(formData: FormData, key: string) {
  const raw = String(formData.get(key) ?? "").trim().replace(",", ".");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}

function text(formData: FormData, key: string, max = 2000) {
  return String(formData.get(key) ?? "").trim().slice(0, max) || null;
}

function revalidateOrders(productId?: string | null) {
  revalidatePath("/[locale]/admin/orders", "page");
  revalidatePath("/[locale]/orders", "page");
  revalidatePath("/[locale]/dashboard", "page");
  if (productId) revalidatePath(`/[locale]/products/${productId}`, "page");
}

async function notifyClient(clientId: string, payload: Record<string, unknown>) {
  try {
    await createNotification({
      clientId,
      type: "purchase_order",
      channels: ["in_app", "email", "whatsapp"],
      payload: { href: "/orders", ...payload },
    });
  } catch {
    // The order itself is saved; notification delivery is best effort.
  }
}

export async function createPurchaseOrderAction(
  _prev: PurchaseOrderActionResult | undefined,
  formData: FormData,
): Promise<PurchaseOrderActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, error: "Accès réservé à l'équipe Voltship." };
  const clientId = text(formData, "client_id", 64);
  const productId = text(formData, "product_id", 64);
  const quantity = num(formData, "quantity");
  const unitPrice = num(formData, "unit_price_eur");
  const total = num(formData, "total_eur");
  if (!clientId) return { ok: false, error: "Choisis le client." };
  if (quantity == null || !Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, error: "Quantité invalide." };
  }
  if ([unitPrice, total].some((value) => value != null && (!Number.isFinite(value) || value < 0))) {
    return { ok: false, error: "Montants invalides." };
  }
  const admin = createAdminClient();
  const [{ data: client }, { data: product }] = await Promise.all([
    admin.from("clients").select("id, code, name").eq("id", clientId).maybeSingle(),
    productId
      ? admin.from("products_cache").select("id, client_id, title, client_price, quote_json").eq("id", productId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!client) return { ok: false, error: "Client introuvable." };
  if (product && product.client_id !== clientId) return { ok: false, error: "Ce produit n'est pas à ce client." };
  const title = text(formData, "title", 200) ?? product?.title ?? null;
  if (!title) return { ok: false, error: "Donne un nom à la commande (ou choisis un produit)." };

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count } = await admin
    .from("purchase_orders")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .gte("created_at", dayStart.toISOString());
  const reference = purchaseOrderReference(client.code ?? client.name, now, count ?? 0);
  const unit = unitPrice ?? (product?.client_price != null ? Number(product.client_price) : null);
  const status: PurchaseOrderStatus = isPurchaseOrderStatus(formData.get("status"))
    ? (formData.get("status") as PurchaseOrderStatus)
    : "to_pay";

  const { data: created, error } = await admin
    .from("purchase_orders")
    .insert({
      client_id: clientId,
      product_id: product?.id ?? null,
      reference,
      title,
      quantity,
      unit_price_eur: unit,
      total_eur: purchaseOrderTotal(quantity, unit, total),
      status,
      eta: text(formData, "eta", 10),
      notes_client: text(formData, "notes_client"),
      notes_internal: text(formData, "notes_internal"),
      history: appendHistory([], status, now),
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  // Restock request turned into this order: mark it so it leaves the "to process" list.
  const restockAt = text(formData, "restock_at", 40);
  if (product && restockAt) {
    const quote = (product.quote_json ?? {}) as Record<string, unknown>;
    const restocks = Array.isArray(quote._restocks) ? (quote._restocks as Array<Record<string, unknown>>) : [];
    const next = restocks.map((entry) => (entry.at === restockAt ? { ...entry, purchase_order_id: created.id } : entry));
    await admin.from("products_cache").update({ quote_json: { ...quote, _restocks: next } }).eq("id", product.id);
  }

  await notifyClient(clientId, {
    purchaseOrderId: created.id,
    reference,
    productId: product?.id ?? null,
    productTitle: title,
    quantity,
    status,
    message: `Nouvelle commande ${reference} : ${quantity} × ${title} (${STATUS_FR[status]}).`,
  });
  revalidateOrders(product?.id);
  return { ok: true };
}

export async function updatePurchaseOrderAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) throw new Error("Accès réservé à l'équipe Voltship.");
  const id = text(formData, "id", 64);
  const status = formData.get("status");
  if (!id || !isPurchaseOrderStatus(status)) throw new Error("Statut invalide.");
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("purchase_orders")
    .select("id, client_id, product_id, reference, title, quantity, status, history, paid_at, received_at")
    .eq("id", id)
    .maybeSingle();
  if (!order) throw new Error("Commande introuvable.");
  const now = new Date();
  const update: Record<string, unknown> = {
    status,
    eta: text(formData, "eta", 10),
    tracking: text(formData, "tracking", 200),
    notes_client: text(formData, "notes_client"),
    notes_internal: text(formData, "notes_internal"),
    history: appendHistory(order.history, status, now),
    updated_at: now.toISOString(),
  };
  if (status !== "to_pay" && status !== "cancelled" && !order.paid_at) update.paid_at = now.toISOString();
  if (status === "received" && !order.received_at) update.received_at = now.toISOString();
  const { error } = await admin.from("purchase_orders").update(update).eq("id", id);
  if (error) throw new Error(error.message);
  if (order.status !== status) {
    await notifyClient(order.client_id, {
      purchaseOrderId: order.id,
      reference: order.reference,
      productId: order.product_id,
      productTitle: order.title,
      quantity: order.quantity,
      status,
      message: `Commande ${order.reference} (${order.quantity} × ${order.title}) : ${STATUS_FR[status]}.`,
    });
  }
  revalidateOrders(order.product_id);
}
