"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth/context";
import { getAirtableConfig } from "@/lib/airtable/config";
import { patchAirtableProduct } from "@/lib/airtable/products";
import { createNotification } from "@/lib/notifications/server";
import {
  calculateLiveProductQuote,
  calculateProductCogsMatrix,
  getProductMarkets,
} from "@/lib/pricing/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProductRow, SourcingStatus } from "@/lib/products/types";
import type { ShippingChannel } from "@/lib/domain/pricing";

export type SourcingActionResult = {
  ok: boolean;
  error?: string;
  nextId?: string;
};

const channels: ShippingChannel[] = [
  "standard",
  "electronics_battery",
  "cosmetics",
  "liquid_perfume",
  "magnetic",
  "sensitive_other",
];

const statuses: SourcingStatus[] = [
  "brief_received",
  "factories",
  "samples",
  "negotiation",
  "quote_sent",
  "validated",
  "in_production",
  "in_stock",
  "flagged",
];

async function requireSourcer() {
  const ctx = await getAuthContext();
  if (!ctx || (ctx.role !== "sourcer" && ctx.role !== "voltship_admin")) {
    return { ctx: null, error: "Sourcer access required." };
  }
  return { ctx, error: null };
}

function nullableNumber(formData: FormData, key: string) {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}

function nullableText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim() || null;
}

async function loadProduct(productId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products_cache")
    .select("*")
    .eq("id", productId)
    .maybeSingle();
  if (error || !data) return { admin, product: null as ProductRow | null };
  return { admin, product: data as ProductRow };
}

function revalidateSourcing(productId: string) {
  revalidatePath("/admin");
  revalidatePath("/sourcer");
  revalidatePath("/[locale]/sourcer", "page");
  revalidatePath(`/sourcer/${productId}`);
  revalidatePath("/[locale]/sourcer/[id]", "page");
  revalidatePath(`/products/${productId}`);
  revalidatePath("/[locale]/products/[id]", "page");
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
}

function parseDraft(formData: FormData) {
  const shippingChannel = nullableText(formData, "shipping_channel");
  const sourcingStatus = (nullableText(formData, "sourcing_status") ??
    "brief_received") as SourcingStatus;
  return {
    client: {
      weight_g: nullableNumber(formData, "weight_g"),
      shipping_channel: shippingChannel,
      production_lead_days: nullableNumber(formData, "production_lead_days"),
      moq: nullableNumber(formData, "moq"),
      client_price: nullableNumber(formData, "client_price"),
      sourcing_status: sourcingStatus,
    },
    internal: {
      factory_purchase_price: nullableNumber(formData, "factory_purchase_price"),
      supplier_name: nullableText(formData, "supplier_name"),
      supplier_contact: nullableText(formData, "supplier_contact"),
      sourcing_location: nullableText(formData, "sourcing_location"),
      internal_notes: nullableText(formData, "internal_notes"),
    },
  };
}

function validateDraft(draft: ReturnType<typeof parseDraft>) {
  const numeric = [
    draft.client.weight_g,
    draft.client.production_lead_days,
    draft.client.moq,
    draft.client.client_price,
    draft.internal.factory_purchase_price,
  ];
  if (numeric.some((value) => value != null && (!Number.isFinite(value) || value < 0))) {
    return "Numeric values must be positive.";
  }
  if (
    draft.client.shipping_channel &&
    !channels.includes(draft.client.shipping_channel as ShippingChannel)
  ) {
    return "Invalid shipping channel.";
  }
  if (!statuses.includes(draft.client.sourcing_status)) return "Invalid sourcing status.";
  return null;
}

async function writeAirtable(product: ProductRow, draft: ReturnType<typeof parseDraft>) {
  if (
    !getAirtableConfig().configured ||
    product.airtable_record_id.startsWith("pending:")
  ) {
    return;
  }
  await patchAirtableProduct(product.airtable_record_id, {
    sourcingStatus: draft.client.sourcing_status,
    weightG: draft.client.weight_g,
    shippingChannel: draft.client.shipping_channel,
    productionLeadDays: draft.client.production_lead_days,
    moq: draft.client.moq,
    clientPrice: draft.client.client_price,
    factoryPurchasePrice: draft.internal.factory_purchase_price,
    supplierName: draft.internal.supplier_name,
    supplierContact: draft.internal.supplier_contact,
    sourcingLocation: draft.internal.sourcing_location,
    internalNotes: draft.internal.internal_notes,
  });
}

async function persistDraft(
  product: ProductRow,
  draft: ReturnType<typeof parseDraft>,
  userId: string,
) {
  await writeAirtable(product, draft);
  const admin = createAdminClient();
  const { error: productError } = await admin
    .from("products_cache")
    .update({
      ...draft.client,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", product.id)
    .eq("client_id", product.client_id);
  if (productError) throw productError;

  const { error: workError } = await admin.from("sourcing_work").upsert({
    product_id: product.id,
    client_id: product.client_id,
    ...draft.internal,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  });
  if (workError) throw workError;
}

export async function saveSourcingDraftAction(
  _prev: SourcingActionResult | undefined,
  formData: FormData,
): Promise<SourcingActionResult> {
  const { ctx, error } = await requireSourcer();
  if (!ctx) return { ok: false, error: error ?? "Sourcer access required." };
  const productId = String(formData.get("product_id") ?? "");
  const { product } = await loadProduct(productId);
  if (!product) return { ok: false, error: "Product not found." };
  const draft = parseDraft(formData);
  const invalid = validateDraft(draft);
  if (invalid) return { ok: false, error: invalid };

  try {
    await persistDraft(product, draft, ctx.userId);
  } catch (writeError) {
    return {
      ok: false,
      error: writeError instanceof Error ? writeError.message : "Could not save sourcing work.",
    };
  }
  revalidateSourcing(productId);
  return { ok: true };
}

export async function sendQuoteAction(
  _prev: SourcingActionResult | undefined,
  formData: FormData,
): Promise<SourcingActionResult> {
  const { ctx, error } = await requireSourcer();
  if (!ctx) return { ok: false, error: error ?? "Sourcer access required." };
  const productId = String(formData.get("product_id") ?? "");
  const { admin, product } = await loadProduct(productId);
  if (!product) return { ok: false, error: "Product not found." };
  const draft = parseDraft(formData);
  draft.client.sourcing_status = "quote_sent";
  const invalid = validateDraft(draft);
  if (invalid) return { ok: false, error: invalid };
  if (
    !draft.client.weight_g ||
    !draft.client.shipping_channel ||
    draft.client.client_price == null
  ) {
    return { ok: false, error: "Weight, shipping channel and client price are required." };
  }

  const candidate = { ...product, ...draft.client } as ProductRow;
  const quote = await calculateLiveProductQuote(candidate);
  if (!quote.breakdown) {
    return {
      ok: false,
      error:
        quote.missingReason === "grid"
          ? "Activate a pricing grid before sending a quote."
          : `No ${quote.destination} rate matches this product.`,
    };
  }

  // COGS for 1..5 units in one parcel (same engine as the client's product card).
  const matrix = await calculateProductCogsMatrix(candidate, {
    markets: getProductMarkets(candidate).slice(0, 1),
  }).catch(() => null);
  const primary = matrix?.markets[0];
  const cogsLadder = (primary?.cells ?? []).map((cell) => ({
    quantity: cell.quantity,
    cogs: cell.breakdown?.cogs != null ? Math.round(cell.breakdown.cogs * 100) / 100 : null,
  }));
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.voltshiplogistics.com").replace(/\/$/, "");
  const shippingLine = [quote.breakdown.carrier, quote.breakdown.lineName].filter(Boolean).join(" ");

  try {
    await persistDraft(product, draft, ctx.userId);
    await createNotification({
      clientId: product.client_id,
      type: "quote_ready",
      channels: ["in_app", "email", "whatsapp"],
      payload: {
        productId: product.id,
        productTitle: product.title,
        productUrl: `${appUrl}/fr/products/${product.id}`,
        photoUrl: product.photo_url ?? null,
        destination: quote.breakdown.destination,
        currency: "EUR",
        cogs: quote.breakdown.cogs,
        cogsLadder,
        weightG: draft.client.weight_g,
        shippingLine: shippingLine || null,
        deliveryRange: quote.breakdown.deliveryRange,
        message: `Quote ready for ${product.title}.`,
      },
    });
  } catch (writeError) {
    return {
      ok: false,
      error: writeError instanceof Error ? writeError.message : "Could not send quote.",
    };
  }

  const { data: next } = await admin
    .from("products_cache")
    .select("id")
    .neq("id", product.id)
    .in("sourcing_status", ["brief_received", "factories", "samples", "negotiation", "flagged"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  revalidateSourcing(productId);
  return { ok: true, nextId: next?.id };
}

export async function flagSourcingAction(
  _prev: SourcingActionResult | undefined,
  formData: FormData,
): Promise<SourcingActionResult> {
  const { ctx, error } = await requireSourcer();
  if (!ctx) return { ok: false, error: error ?? "Sourcer access required." };
  const productId = String(formData.get("product_id") ?? "");
  const reason = String(formData.get("flagged_reason") ?? "").trim();
  if (!reason) return { ok: false, error: "Add a reason before flagging." };
  const { admin, product } = await loadProduct(productId);
  if (!product) return { ok: false, error: "Product not found." };

  try {
    if (
      getAirtableConfig().configured &&
      !product.airtable_record_id.startsWith("pending:")
    ) {
      await patchAirtableProduct(product.airtable_record_id, {
        sourcingStatus: "flagged",
        flaggedReason: reason,
      });
    }
    await admin
      .from("products_cache")
      .update({ sourcing_status: "flagged" })
      .eq("id", product.id)
      .eq("client_id", product.client_id);
    await admin.from("sourcing_work").upsert({
      product_id: product.id,
      client_id: product.client_id,
      flagged_reason: reason,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    });
  } catch (writeError) {
    return {
      ok: false,
      error: writeError instanceof Error ? writeError.message : "Could not flag product.",
    };
  }
  revalidateSourcing(productId);
  return { ok: true };
}
