"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/auth/audit";
import { getAuthContext } from "@/lib/auth/context";
import { encryptEccangToken } from "@/lib/eccang/crypto";
import {
  getCredentialsForClient,
  getShippingMethods,
  getWarehouses,
  isEccangConfigured,
  type EccangShippingMethod,
  type EccangWarehouse,
} from "@/lib/eccang/client";
import { parseShippingMethodMap } from "@/lib/eccang/mapping";
import {
  getShippingMethodMap,
  pushValidatedProducts,
  saveShippingMethodMap,
  syncClient,
} from "@/lib/eccang/sync";
import type { ActionResult } from "@/app/actions/admin";

export type EccangActionResult = ActionResult & {
  warehouses?: EccangWarehouse[];
  shippingMethods?: EccangShippingMethod[];
  summary?: string;
};

async function requireAdmin() {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "voltship_admin") {
    return { ctx: null, error: "Admin access required." as const };
  }
  return { ctx, error: null };
}

function revalidateClient(clientId: string) {
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/[locale]/admin/clients/[id]", "page");
  revalidatePath("/admin");
  revalidatePath("/[locale]/admin", "page");
}

/** Saves enabled / appKey / appToken (write-only) / warehouse code. Token encrypted at rest. */
export async function saveEccangSettingsAction(
  _prev: EccangActionResult | undefined,
  formData: FormData,
): Promise<EccangActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error };

  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!clientId) return { ok: false, error: "Missing client." };
  const enabled = formData.get("eccang_enabled") === "on";
  const appKey = String(formData.get("app_key") ?? "").trim();
  const appToken = String(formData.get("app_token") ?? "").trim();
  const warehouseCode = String(formData.get("warehouse_code") ?? "").trim();

  const admin = createAdminClient();
  const { data: current } = await admin
    .from("clients")
    .select("eccang_app_key, eccang_app_token_encrypted, eccang_warehouse_code, eccang_enabled")
    .eq("id", clientId)
    .maybeSingle();
  if (!current) return { ok: false, error: "Client not found." };

  const update: Record<string, unknown> = {
    eccang_enabled: enabled,
    eccang_app_key: appKey || null,
    eccang_warehouse_code: warehouseCode || null,
  };
  if (appToken) {
    try {
      update.eccang_app_token_encrypted = encryptEccangToken(appToken);
    } catch (cryptoError) {
      return { ok: false, error: cryptoError instanceof Error ? cryptoError.message : "Encryption key missing." };
    }
  }
  if (!appKey) update.eccang_app_token_encrypted = null;
  const hasToken = Boolean(appToken || (appKey && current.eccang_app_token_encrypted));
  if (enabled && (!appKey || !hasToken || !warehouseCode)) {
    return {
      ok: false,
      error: "To enable ECCANG, fill the appKey, the appToken and pick a warehouse.",
    };
  }
  if (enabled && !isEccangConfigured()) {
    return { ok: false, error: "ECCANG_API_HOST is not set on the server." };
  }
  if (enabled) update.eccang_sync_error = null;

  const { error: updateError } = await admin.from("clients").update(update).eq("id", clientId);
  if (updateError) return { ok: false, error: updateError.message };

  await writeAudit({
    actorUserId: ctx.userId,
    clientId,
    action: "client.eccang_settings",
    entity: "clients",
    diff: {
      enabled: { from: current.eccang_enabled, to: enabled },
      app_key: { from: current.eccang_app_key, to: appKey || null },
      warehouse_code: { from: current.eccang_warehouse_code, to: warehouseCode || null },
      token_rotated: Boolean(appToken),
    },
  });
  revalidateClient(clientId);
  return { ok: true, clientId };
}

/** "Tester la connexion": getWarehouse (+ getShippingMethod) with the stored credentials. */
export async function testEccangConnectionAction(
  _prev: EccangActionResult | undefined,
  formData: FormData,
): Promise<EccangActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error };
  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!clientId) return { ok: false, error: "Missing client." };
  if (!isEccangConfigured()) return { ok: false, error: "ECCANG_API_HOST is not set on the server." };
  try {
    const config = await getCredentialsForClient(clientId);
    if (!config.credentials) return { ok: false, error: "Save the appKey and appToken first." };
    const warehouses = await getWarehouses(config.credentials);
    let shippingMethods: EccangShippingMethod[] = [];
    try {
      shippingMethods = await getShippingMethods(config.credentials, config.warehouseCode);
    } catch {
      shippingMethods = [];
    }
    return {
      ok: true,
      clientId,
      warehouses,
      shippingMethods,
      summary: `${warehouses.length} warehouse(s), ${shippingMethods.length} shipping method(s).`,
    };
  } catch (apiError) {
    return { ok: false, error: apiError instanceof Error ? apiError.message : "ECCANG call failed." };
  }
}

/** "Synchroniser maintenant": inventory + pending orders + ASNs for one client. */
export async function syncEccangNowAction(
  _prev: EccangActionResult | undefined,
  formData: FormData,
): Promise<EccangActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error };
  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!clientId) return { ok: false, error: "Missing client." };
  if (!isEccangConfigured()) return { ok: false, error: "ECCANG_API_HOST is not set on the server." };
  const summary = await syncClient(clientId);
  revalidateClient(clientId);
  const text = `${summary.inventory} SKU, ${summary.orders} orders polled, ${summary.asns} inbound notices.`;
  if (summary.errors.length) {
    return { ok: false, clientId, error: `${text} Errors: ${summary.errors.join(" | ")}` };
  }
  return { ok: true, clientId, summary: text };
}

/** "Pousser tous les produits validés". */
export async function pushEccangProductsAction(
  _prev: EccangActionResult | undefined,
  formData: FormData,
): Promise<EccangActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error };
  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!clientId) return { ok: false, error: "Missing client." };
  if (!isEccangConfigured()) return { ok: false, error: "ECCANG_API_HOST is not set on the server." };
  try {
    const result = await pushValidatedProducts(clientId);
    await writeAudit({
      actorUserId: ctx.userId,
      clientId,
      action: "client.eccang_push_products",
      entity: "products_cache",
      diff: { pushed: result.pushed, failed: result.failed.length },
    });
    revalidateClient(clientId);
    const text = `${result.pushed} product(s) pushed.`;
    if (result.failed.length) {
      return {
        ok: false,
        clientId,
        error: `${text} Failed: ${result.failed.map((f) => `${f.sku} (${f.error})`).join("; ")}`,
      };
    }
    return { ok: true, clientId, summary: text };
  } catch (apiError) {
    return { ok: false, error: apiError instanceof Error ? apiError.message : "Push failed." };
  }
}

/** Saves the global carrier/line → ECCANG shipping-method map (pricing_meta JSON). */
export async function saveEccangShippingMapAction(
  _prev: EccangActionResult | undefined,
  formData: FormData,
): Promise<EccangActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error };
  const clientId = String(formData.get("client_id") ?? "").trim();
  const keys = formData.getAll("map_key").map((value) => String(value).trim());
  const codes = formData.getAll("map_code").map((value) => String(value).trim());
  const map: Record<string, string> = {};
  keys.forEach((key, index) => {
    const code = codes[index] ?? "";
    if (key && code) map[key] = code;
  });
  const before = await getShippingMethodMap();
  try {
    await saveShippingMethodMap(parseShippingMethodMap(map));
  } catch (saveError) {
    return { ok: false, error: saveError instanceof Error ? saveError.message : "Could not save." };
  }
  await writeAudit({
    actorUserId: ctx.userId,
    clientId: clientId || null,
    action: "pricing.eccang_shipping_map",
    entity: "pricing_meta",
    diff: { from: before, to: map },
  });
  if (clientId) revalidateClient(clientId);
  revalidatePath("/admin/pricing");
  return { ok: true, clientId: clientId || undefined };
}
