"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthContext } from "@/lib/auth/context";
import { getAirtableConfig } from "@/lib/airtable/config";
import {
  createAirtableProduct,
  createAirtableSourcingRequest,
  patchAirtableProduct,
} from "@/lib/airtable/products";
import { parseFinancialProfile } from "@/lib/domain/economics";
import {
  canGenerateResearch,
  researchMonthlyQuota,
} from "@/lib/domain/entitlements";
import { freezeQuote } from "@/lib/domain/pricing";
import { calculateLiveProductQuote } from "@/lib/pricing/server";
import { createNotification } from "@/lib/notifications/server";
import { buildResearchBlock } from "@/lib/products/research";
import type { ProductRequest, ProductRow, ResearchKind } from "@/lib/products/types";
import type { ActionResult } from "@/app/actions/admin";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/events";

async function requireTenant() {
  const ctx = await getAuthContext();
  if (!ctx?.clientId) {
    return { ctx: null, error: "Not signed in to a workspace." };
  }
  return { ctx, error: null };
}

export async function createProductAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };

  const title = String(formData.get("title") ?? "").trim();
  const sourceUrl = String(formData.get("source_url") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const destinations = String(formData.get("destinations") ?? "").trim();
  const targetPriceRaw = String(formData.get("target_price") ?? "").trim();
  const launchQtyRaw = String(formData.get("launch_qty") ?? "").trim();
  const targetPrice = targetPriceRaw ? Number(targetPriceRaw) : null;
  const launchQty = launchQtyRaw ? Number(launchQtyRaw) : null;
  const photo = formData.get("photo");

  if (title.length < 2) return { ok: false, error: "Product name is required." };

  const admin = createAdminClient();
  const id = randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  const request: ProductRequest = {
    description,
    source_url: sourceUrl,
    target_unit_price: targetPrice != null && Number.isFinite(targetPrice) ? targetPrice : null,
    expected_launch_qty: launchQty != null && Number.isFinite(launchQty) ? launchQty : null,
    destination_markets: destinations,
    notes,
  };

  let photoUrl: string | null = null;
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > 10 * 1024 * 1024) {
      return { ok: false, error: "Product photo must be smaller than 10 MB." };
    }
    if (!photo.type.startsWith("image/")) {
      return { ok: false, error: "Product photo must be an image." };
    }
    const extension = photo.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "jpg";
    const path = `${ctx.clientId}/${id}/product.${extension}`;
    const { error: uploadError } = await admin.storage
      .from("product-uploads")
      .upload(path, photo, { contentType: photo.type, upsert: true });
    if (uploadError) return { ok: false, error: uploadError.message };
    const { data: signed } = await admin.storage
      .from("product-uploads")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    photoUrl = signed?.signedUrl ?? null;
  }

  const airtableConfig = getAirtableConfig();
  let airtableRecordId = `pending:${id}`;
  if (airtableConfig.configured) {
    const { data: client } = await admin
      .from("clients")
      .select("name, airtable_client_record_id")
      .eq("id", ctx.clientId)
      .maybeSingle();
    try {
      const record = await createAirtableProduct({
        clientId: ctx.clientId,
        clientName: client?.name,
        airtableClientRecordId: client?.airtable_client_record_id,
        title,
        photoUrl,
        request,
      });
      airtableRecordId = record.id;
    } catch (airtableError) {
      return {
        ok: false,
        error:
          airtableError instanceof Error
            ? airtableError.message
            : "Could not create the Airtable product.",
      };
    }
  }

  const { data, error: insertError } = await admin
    .from("products_cache")
    .insert({
      id,
      client_id: ctx.clientId,
      airtable_record_id: airtableRecordId,
      title,
      sku: null,
      photo_url: photoUrl,
      created_date: today,
      lifecycle_status: "testing",
      sourcing_status: "brief_received",
      quote_json: {
        _request: request,
        _sync: {
          status: airtableRecordId.startsWith("pending:") ? "pending" : "synced",
        },
      },
      last_synced_at: airtableRecordId.startsWith("pending:")
        ? null
        : new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !data) {
    return { ok: false, error: insertError?.message ?? "Could not create product." };
  }

  revalidatePath("/products");
  revalidatePath("/dashboard");
  return { ok: true, clientId: data.id };
}

function revalidateProduct(productId: string) {
  revalidatePath(`/products/${productId}`);
  revalidatePath("/[locale]/products/[id]", "page");
  revalidatePath("/products");
  revalidatePath("/[locale]/products", "page");
  revalidatePath("/notifications");
  revalidatePath("/[locale]/notifications", "page");
  revalidatePath("/dashboard");
}

async function loadTenantProduct(clientId: string, productId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products_cache")
    .select("*")
    .eq("id", productId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !data) return { admin, product: null as ProductRow | null };
  return { admin, product: data as ProductRow };
}

function quoteRecord(product: ProductRow | null) {
  const raw = product?.quote_json;
  return raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
}

async function notifyTenant(
  _admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  userId: string,
  type: string,
  payload: Record<string, unknown>,
  channels: string[] = ["in_app"],
) {
  try {
    await createNotification({
      clientId,
      userId,
      type,
      payload,
      channels,
    });
  } catch {
    // Product mutation already succeeded; notification is best-effort.
  }
}

export async function updateSellingPriceAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };

  const productId = String(formData.get("product_id") ?? "");
  const raw = String(formData.get("selling_price") ?? "").trim();
  const sellingPrice = raw === "" ? null : Number(raw);

  if (!productId) return { ok: false, error: "Missing product." };
  if (sellingPrice != null && (!Number.isFinite(sellingPrice) || sellingPrice < 0)) {
    return { ok: false, error: "Selling price must be a number." };
  }

  const { admin, product } = await loadTenantProduct(ctx.clientId, productId);
  if (!product) return { ok: false, error: "Product not found." };
  const { error: updateError } = await admin
    .from("products_cache")
    .update({ selling_price: sellingPrice })
    .eq("id", productId)
    .eq("client_id", ctx.clientId);

  if (updateError) return { ok: false, error: updateError.message };

  if (
    getAirtableConfig().configured &&
    !product.airtable_record_id.startsWith("pending:")
  ) {
    try {
      await patchAirtableProduct(product.airtable_record_id, { sellingPrice });
    } catch (airtableError) {
      return {
        ok: false,
        error:
          airtableError instanceof Error
            ? airtableError.message
            : "Price saved locally but Airtable sync failed.",
      };
    }
  }

  revalidateProduct(productId);
  return { ok: true };
}

export async function acceptQuoteAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };

  const productId = String(formData.get("product_id") ?? "");
  if (!productId) return { ok: false, error: "Missing product." };

  const { admin, product } = await loadTenantProduct(ctx.clientId, productId);
  if (!product) return { ok: false, error: "Product not found." };

  const liveQuote = await calculateLiveProductQuote(product);
  if (!liveQuote.breakdown) {
    return {
      ok: false,
      error:
        liveQuote.missingReason === "grid"
          ? "Quote cannot be accepted until an active pricing grid exists."
          : liveQuote.missingReason === "rate"
            ? "No shipping rate matches this product yet."
            : "Quote is not ready yet. Voltship still needs to fill price, weight and channel.",
    };
  }

  const snapshot = freezeQuote(liveQuote.breakdown);

  if (
    getAirtableConfig().configured &&
    !product.airtable_record_id.startsWith("pending:")
  ) {
    try {
      await patchAirtableProduct(product.airtable_record_id, {
        sourcingStatus: "validated",
        acceptedQuoteJson: JSON.stringify(snapshot),
      });
    } catch (airtableError) {
      return {
        ok: false,
        error:
          airtableError instanceof Error
            ? airtableError.message
            : "Could not update the accepted quote in Airtable.",
      };
    }
  }

  const { error: updateError } = await admin
    .from("products_cache")
    .update({
      accepted_quote_snapshot_json: snapshot,
      sourcing_status: "validated",
    })
    .eq("id", productId)
    .eq("client_id", ctx.clientId);

  if (updateError) return { ok: false, error: updateError.message };

  await notifyTenant(admin, ctx.clientId, ctx.userId, "quote_accepted", {
    productId,
    productTitle: product.title,
    message: `Quote accepted for ${product.title}.`,
  }, ["in_app", "email", "whatsapp"]);

  revalidateProduct(productId);
  return { ok: true };
}

export async function askQuoteQuestionAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };

  const productId = String(formData.get("product_id") ?? "");
  const text = String(formData.get("question") ?? "").trim();
  if (!productId) return { ok: false, error: "Missing product." };
  if (text.length < 2) return { ok: false, error: "Write a short question for Voltship." };

  const { admin, product } = await loadTenantProduct(ctx.clientId, productId);
  if (!product) return { ok: false, error: "Product not found." };

  const quote = quoteRecord(product);
  const questions = Array.isArray(quote._questions) ? [...quote._questions] : [];
  questions.push({ text, at: new Date().toISOString() });

  if (
    getAirtableConfig().configured &&
    !product.airtable_record_id.startsWith("pending:")
  ) {
    try {
      await patchAirtableProduct(product.airtable_record_id, {
        quoteQuestionsJson: JSON.stringify(questions),
      });
    } catch (airtableError) {
      return {
        ok: false,
        error:
          airtableError instanceof Error
            ? airtableError.message
            : "Could not sync the quote question.",
      };
    }
  }

  const { error: updateError } = await admin
    .from("products_cache")
    .update({ quote_json: { ...quote, _questions: questions } })
    .eq("id", productId)
    .eq("client_id", ctx.clientId);

  if (updateError) return { ok: false, error: updateError.message };

  await notifyTenant(admin, ctx.clientId, ctx.userId, "quote_question", {
    productId,
    productTitle: product.title,
    message: text,
  });

  revalidateProduct(productId);
  return { ok: true };
}

export async function requestResearchAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };

  const productId = String(formData.get("product_id") ?? "");
  const kinds = String(formData.get("kinds") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(
      (item): item is ResearchKind =>
        item === "brief" || item === "reddit" || item === "personas",
    );

  if (!productId) return { ok: false, error: "Missing product." };
  if (kinds.length === 0) return { ok: false, error: "Choose a research pack." };

  const { admin, product } = await loadTenantProduct(ctx.clientId, productId);
  if (!product) return { ok: false, error: "Product not found." };

  const { data: client } = await admin
    .from("clients")
    .select("plan_tier")
    .eq("id", ctx.clientId)
    .maybeSingle();
  const tier = client?.plan_tier ?? "bronze";
  const locked = kinds.find((kind) => !canGenerateResearch(tier, kind));
  if (locked) {
    return { ok: false, error: `${locked} research is not included in the ${tier} plan.` };
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await admin
    .from("generation_usage")
    .select("id", { count: "exact", head: true })
    .eq("client_id", ctx.clientId)
    .gte("created_at", monthStart.toISOString());
  const quota = researchMonthlyQuota(tier);
  if ((count ?? 0) + kinds.length > quota) {
    return { ok: false, error: `Monthly research quota reached (${quota}).` };
  }

  const quote = quoteRecord(product);
  const research =
    quote._research && typeof quote._research === "object"
      ? { ...(quote._research as Record<string, unknown>) }
      : {};
  const request =
    quote._request && typeof quote._request === "object"
      ? (quote._request as ProductRequest)
      : {};
  const numOrNull = (value: unknown) => {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const input = {
    title: String(product.title ?? "Product"),
    request,
    sellingPrice: numOrNull(product.selling_price),
    clientPrice: numOrNull(product.client_price),
  };
  const webhookUrl = process.env.N8N_RESEARCH_WEBHOOK_URL;
  const now = new Date().toISOString();
  for (const kind of kinds) {
    research[kind] = webhookUrl
      ? { status: "generating", requested_at: now }
      : buildResearchBlock(kind, input);
  }

  if (
    getAirtableConfig().configured &&
    !product.airtable_record_id.startsWith("pending:")
  ) {
    try {
      await patchAirtableProduct(product.airtable_record_id, {
        researchJson: JSON.stringify(research),
      });
    } catch (airtableError) {
      return {
        ok: false,
        error:
          airtableError instanceof Error
            ? airtableError.message
            : "Could not sync the research request.",
      };
    }
  }

  const { error: updateError } = await admin
    .from("products_cache")
    .update({ quote_json: { ...quote, _research: research } })
    .eq("id", productId)
    .eq("client_id", ctx.clientId);

  if (updateError) return { ok: false, error: updateError.message };

  const usageRows = kinds.map((kind) => ({
    client_id: ctx.clientId,
    user_id: ctx.userId,
    deliverable_type: kind,
  }));
  await admin.from("generation_usage").insert(usageRows);

  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.N8N_SHARED_SECRET
            ? { Authorization: `Bearer ${process.env.N8N_SHARED_SECRET}` }
            : {}),
        },
        body: JSON.stringify({
          client_id: ctx.clientId,
          product_id: product.id,
          airtable_record_id: product.airtable_record_id,
          deliverable_types: kinds,
        }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Research service returned ${response.status}.`);
      await notifyTenant(admin, ctx.clientId, ctx.userId, "research_requested", {
        productId,
        productTitle: product.title,
        message: `Research started for ${product.title}.`,
        kinds,
      });
    } catch (dispatchError) {
      for (const kind of kinds) {
        research[kind] = {
          status: "not_generated",
          error:
            dispatchError instanceof Error
              ? dispatchError.message
              : "Research dispatch failed.",
        };
      }
      await admin
        .from("products_cache")
        .update({ quote_json: { ...quote, _research: research } })
        .eq("id", productId)
        .eq("client_id", ctx.clientId);
      revalidateProduct(productId);
      return {
        ok: false,
        error:
          dispatchError instanceof Error
            ? dispatchError.message
            : "Research dispatch failed.",
      };
    }
  } else {
    await notifyTenant(admin, ctx.clientId, ctx.userId, "research_ready", {
      productId,
      productTitle: product.title,
      message: `Research pack ready for ${product.title}.`,
      kinds,
    });
  }

  revalidateProduct(productId);
  return { ok: true };
}

export async function requestRestockAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };

  const productId = String(formData.get("product_id") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  const qtyRaw = String(formData.get("qty") ?? "").trim();
  const qty = qtyRaw === "" ? null : Number(qtyRaw);

  if (!productId) return { ok: false, error: "Missing product." };
  if (qty != null && (!Number.isFinite(qty) || qty <= 0)) {
    return { ok: false, error: "Quantity must be a positive number." };
  }
  if (!notes && qty == null) {
    return { ok: false, error: "Add a quantity or a short note." };
  }

  const { admin, product } = await loadTenantProduct(ctx.clientId, productId);
  if (!product) return { ok: false, error: "Product not found." };

  const quote = quoteRecord(product);
  const restocks = Array.isArray(quote._restocks) ? [...quote._restocks] : [];
  restocks.push({ qty, notes, at: new Date().toISOString() });

  if (getAirtableConfig().configured) {
    const { data: client } = await admin
      .from("clients")
      .select("name")
      .eq("id", ctx.clientId)
      .maybeSingle();
    try {
      if (!product.airtable_record_id.startsWith("pending:")) {
        await patchAirtableProduct(product.airtable_record_id, {
          restockRequestsJson: JSON.stringify(restocks),
        });
      }
      await createAirtableSourcingRequest({
        clientName: client?.name ?? "Client",
        productTitle: product.title,
        qty,
        notes: notes || "Launch restock",
      });
    } catch (airtableError) {
      return {
        ok: false,
        error:
          airtableError instanceof Error
            ? airtableError.message
            : "Could not sync the restock request.",
      };
    }
  }

  const { error: updateError } = await admin
    .from("products_cache")
    .update({ quote_json: { ...quote, _restocks: restocks } })
    .eq("id", productId)
    .eq("client_id", ctx.clientId);

  if (updateError) return { ok: false, error: updateError.message };

  await notifyTenant(admin, ctx.clientId, ctx.userId, "restock_requested", {
    productId,
    productTitle: product.title,
    message: notes || `Restock requested${qty ? ` (${qty})` : ""} for ${product.title}.`,
    qty,
  });

  revalidateProduct(productId);
  revalidatePath("/sourcer");
  revalidatePath("/admin");
  return { ok: true };
}

export async function updateFinancialProfileAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };
  if (ctx.role === "staff") {
    return { ok: false, error: "Only the company owner can edit the financial profile." };
  }

  const num = (key: string) => {
    const value = Number(formData.get(key));
    return Number.isFinite(value) ? value : 0;
  };

  const profile = parseFinancialProfile({
    psp_pct: num("psp_pct"),
    urssaf_pct: num("urssaf_pct"),
    vat_pct: num("vat_pct"),
    other_pct: num("other_pct"),
    min_margin_pct: num("min_margin_pct"),
    target_margin_pct: num("target_margin_pct"),
  });
  const safetyBufferDays = wholeDays(formData.get("safety_buffer_days"), 0, 180);
  const coverageTargetDays = wholeDays(formData.get("coverage_target_days"), 1, 365);
  if (safetyBufferDays == null || coverageTargetDays == null) {
    return {
      ok: false,
      error: "Safety buffer must be 0–180 days and coverage target must be 1–365 days.",
    };
  }

  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("clients")
    .update({
      financial_profile_json: profile,
      safety_buffer_days: safetyBufferDays,
      coverage_target_days: coverageTargetDays,
    })
    .eq("id", ctx.clientId);

  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/settings");
  revalidatePath("/products");
  revalidatePath("/dashboard");
  return { ok: true };
}

function wholeDays(value: FormDataEntryValue | null, min: number, max: number) {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export async function requestOpsFollowUpAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };

  const productId = String(formData.get("product_id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const note =
    kind === "packaging"
      ? "Upgrade to branded packaging"
      : kind === "clearance"
        ? "Clearance options / free storage ending"
        : "";
  if (!productId || !note) return { ok: false, error: "Missing product request." };

  const { admin, product } = await loadTenantProduct(ctx.clientId, productId);
  if (!product) return { ok: false, error: "Product not found." };

  const quote = quoteRecord(product);
  const requests = Array.isArray(quote._ops_requests) ? [...quote._ops_requests] : [];
  requests.push({ kind, note, at: new Date().toISOString() });
  const { error: updateError } = await admin
    .from("products_cache")
    .update({ quote_json: { ...quote, _ops_requests: requests } })
    .eq("id", productId)
    .eq("client_id", ctx.clientId);
  if (updateError) return { ok: false, error: updateError.message };

  await notifyTenant(admin, ctx.clientId, ctx.userId, "ops_request", {
    productId,
    productTitle: product.title,
    message: `${note} requested for ${product.title}.`,
    kind,
  });
  revalidateProduct(productId);
  return { ok: true };
}

export async function markNotificationReadAction(id: string): Promise<ActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };

  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("client_id", ctx.clientId);

  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/notifications");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };

  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("client_id", ctx.clientId)
    .is("read_at", null);
  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/notifications");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateNotificationPreferencesAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireTenant();
  if (!ctx?.clientId) return { ok: false, error: error ?? "Not signed in to a workspace." };
  if (ctx.role === "staff") {
    return { ok: false, error: "Only the company owner can edit notification preferences." };
  }

  const userId = ctx.impersonatedUserId ?? ctx.userId;
  const admin = createAdminClient();
  const rows = NOTIFICATION_EVENTS.map((eventType) => ({
    client_id: ctx.clientId,
    user_id: userId,
    event_type: eventType,
    in_app: formData.get(`${eventType}.in_app`) === "on",
    email: formData.get(`${eventType}.email`) === "on",
    whatsapp: formData.get(`${eventType}.whatsapp`) === "on",
  }));
  const { error: upsertError } = await admin
    .from("notification_preferences")
    .upsert(rows, { onConflict: "user_id,event_type" });
  if (upsertError) return { ok: false, error: upsertError.message };

  revalidatePath("/settings");
  return { ok: true };
}
