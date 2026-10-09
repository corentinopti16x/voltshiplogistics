import "server-only";

import { randomUUID } from "crypto";
import { keepAppMarkets } from "./keep-markets";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProductRequest } from "@/lib/products/types";
import { getAirtableConfig } from "./config";
import {
  isTemporaryAirtableImage,
  productImagesFromAirtableFields,
} from "./images";
import {
  createAirtableRecord,
  listAirtableRecords,
  updateAirtableRecord,
  type AirtableRecord,
} from "./client";

const lifecycleStatuses = new Set(["testing", "winning", "declining", "dead", "archived"]);
const sourcingStatuses = new Set([
  "brief_received",
  "factories",
  "samples",
  "negotiation",
  "quote_sent",
  "validated",
  "in_production",
  "in_stock",
  "flagged",
]);
const shippingChannels = new Set([
  "standard",
  "electronics_battery",
  "cosmetics",
  "liquid_perfume",
  "magnetic",
  "sensitive_other",
]);

export type NewAirtableProduct = {
  clientId: string;
  clientName?: string | null;
  airtableClientRecordId?: string | null;
  title: string;
  photoUrl?: string | null;
  request: ProductRequest;
};

function compact(fields: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

function firstValue(value: unknown) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function stringValue(value: unknown) {
  const item = firstValue(value);
  return typeof item === "string" ? item : null;
}

function numberValue(value: unknown) {
  const item = firstValue(value);
  const parsed = Number(item);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStatus(value: unknown) {
  return (stringValue(value) ?? "").trim().toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

const clientUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseRequest(value: unknown): ProductRequest {
  if (typeof value === "object" && value) return value as ProductRequest;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as ProductRequest) : {};
  } catch {
    return {};
  }
}

export function newProductFields(input: NewAirtableProduct) {
  const { fields, clientAsName } = getAirtableConfig();
  const clientCell = clientAsName
    ? input.clientName || input.clientId
    : input.airtableClientRecordId
      ? [input.airtableClientRecordId]
      : input.clientId;
  return compact({
    [fields.client]: clientCell,
    [fields.title]: input.title,
    [fields.photoUrl]: input.photoUrl,
    [fields.createdDate]: new Date().toISOString().slice(0, 10),
    [fields.lifecycleStatus]: "testing",
    [fields.sourcingStatus]: "brief_received",
    [fields.requestJson]: JSON.stringify(input.request),
  });
}

export async function createAirtableProduct(input: NewAirtableProduct) {
  const config = getAirtableConfig();
  return createAirtableRecord(config.productsTable, newProductFields(input));
}

export async function createAirtableSourcingRequest(input: {
  clientName: string;
  productTitle: string;
  qty: number | null;
  notes: string;
}) {
  const table = process.env.AIRTABLE_SOURCING_TABLE || "Sourcing Requests";
  return createAirtableRecord(
    table,
    compact({
      "Request title": `Restock · ${input.productTitle}`,
      Client: input.clientName,
      Product: input.productTitle,
      Brief: input.notes || "Launch restock",
      "Launch quantity": input.qty && input.qty > 0 ? String(Math.ceil(input.qty)) : undefined,
      "Request date": new Date().toISOString().slice(0, 10),
      Status: "brief_received",
    }),
  );
}

export async function patchAirtableProduct(
  airtableRecordId: string,
  values: Partial<{
    lifecycleStatus: string;
    sourcingStatus: string;
    sellingPrice: number | null;
    weightG: number | null;
    shippingChannel: string | null;
    productionLeadDays: number | null;
    moq: number | null;
    clientPrice: number | null;
    factoryPurchasePrice: number | null;
    supplierName: string | null;
    supplierContact: string | null;
    sourcingLocation: string | null;
    internalNotes: string | null;
    flaggedReason: string | null;
    acceptedQuoteJson: string | null;
    quoteQuestionsJson: string | null;
    restockRequestsJson: string | null;
    researchJson: string | null;
  }>,
) {
  const config = getAirtableConfig();
  const f = config.fields;
  return updateAirtableRecord(
    config.productsTable,
    airtableRecordId,
    compact({
      [f.lifecycleStatus]: values.lifecycleStatus,
      [f.sourcingStatus]: values.sourcingStatus,
      [f.sellingPrice]: values.sellingPrice,
      [f.weightG]: values.weightG,
      [f.shippingChannel]: values.shippingChannel,
      [f.productionLeadDays]: values.productionLeadDays,
      [f.moq]: values.moq,
      [f.clientPrice]: values.clientPrice,
      [f.factoryPurchasePrice]: values.factoryPurchasePrice,
      [f.supplierName]: values.supplierName,
      [f.supplierContact]: values.supplierContact,
      [f.sourcingLocation]: values.sourcingLocation,
      [f.internalNotes]: values.internalNotes,
      [f.flaggedReason]: values.flaggedReason,
      [f.acceptedQuoteJson]: values.acceptedQuoteJson,
      [f.quoteQuestionsJson]: values.quoteQuestionsJson,
      [f.restockRequestsJson]: values.restockRequestsJson,
      [f.researchJson]: values.researchJson,
    }),
  );
}

export async function airtableRecordToCache(
  record: AirtableRecord,
  knownClientId?: string | null,
) {
  const { fields: f } = getAirtableConfig();
  const fields = record.fields;
  const clientReference = stringValue(fields[f.client]);
  let clientId = knownClientId ?? null;
  if (!clientId && clientReference) {
    const admin = createAdminClient();
    let query = admin
      .from("clients")
      .select("id")
      .limit(1);
    query = clientReference.startsWith("rec")
      ? query.eq("airtable_client_record_id", clientReference)
      : clientUuid.test(clientReference)
        ? query.eq("id", clientReference)
        : query.ilike("name", clientReference);
    const { data } = await query.maybeSingle();
    clientId = data?.id ?? null;
  }
  if (!clientId) return null;

  const lifecycleRaw = normalizeStatus(fields[f.lifecycleStatus]);
  const sourcingRaw = normalizeStatus(fields[f.sourcingStatus]);
  const shippingRaw = normalizeStatus(fields[f.shippingChannel]);
  const lifecycle = lifecycleStatuses.has(lifecycleRaw) ? lifecycleRaw : "testing";
  const sourcing = sourcingStatuses.has(sourcingRaw) ? sourcingRaw : "brief_received";
  const request = parseRequest(fields[f.requestJson]);
  return {
    client_id: clientId,
    airtable_record_id: record.id,
    title: stringValue(fields[f.title]) || "Untitled product",
    sku: stringValue(fields[f.sku]),
    photo_url: productImagesFromAirtableFields(fields, f.photoUrl)[0]?.url ?? null,
    created_date:
      stringValue(fields[f.createdDate]) || record.createdTime.slice(0, 10),
    lifecycle_status: lifecycle,
    sourcing_status: sourcing,
    quote_json: { _request: request, _sync: { status: "synced" } },
    selling_price: numberValue(fields[f.sellingPrice]),
    weight_g: numberValue(fields[f.weightG]),
    shipping_channel: shippingChannels.has(shippingRaw) ? shippingRaw : null,
    production_lead_days: numberValue(fields[f.productionLeadDays]),
    moq: numberValue(fields[f.moq]),
    client_price: numberValue(fields[f.clientPrice]),
    stock_manual: numberValue(fields[f.stockManual]),
    last_synced_at: new Date().toISOString(),
  };
}

async function storeAirtableImage(clientId: string, recordId: string, sourceUrl: string) {
  try {
    const response = await fetch(sourceUrl, { cache: "no-store" });
    if (!response.ok) return sourceUrl;
    const contentType = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    if (!contentType.startsWith("image/")) return sourceUrl;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024) return sourceUrl;
    const extension = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : contentType.includes("gif")
          ? "gif"
          : "jpg";
    const path = `${clientId}/airtable/${recordId}.${extension}`;
    const admin = createAdminClient();
    const { error } = await admin.storage.from("product-uploads").upload(path, bytes, {
      contentType,
      upsert: true,
    });
    if (error) return sourceUrl;
    const { data } = await admin.storage
      .from("product-uploads")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    return data?.signedUrl ?? sourceUrl;
  } catch {
    return sourceUrl;
  }
}

export async function syncAirtableRecord(
  record: AirtableRecord,
  knownClientId?: string | null,
) {
  const row = await airtableRecordToCache(record, knownClientId);
  if (!row) return { ok: false as const, error: "Could not resolve Airtable client." };
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("products_cache")
    .select(
      "id, sku, photo_url, quote_json, accepted_quote_snapshot_json, lifecycle_status, sourcing_status, migration_state, selling_price, weight_g, shipping_channel, production_lead_days, moq, client_price, stock_manual",
    )
    .eq("airtable_record_id", record.id)
    .maybeSingle();
  const existingQuote =
    existing?.quote_json && typeof existing.quote_json === "object"
      ? (existing.quote_json as Record<string, unknown>)
      : {};
  const images = productImagesFromAirtableFields(record.fields, getAirtableConfig().fields.photoUrl);
  const source = images[0] ?? null;
  const previousSource =
    typeof existingQuote._photo_source === "string" ? existingQuote._photo_source : null;
  let photoUrl = existing?.photo_url ?? null;
  if (source && (source.id !== previousSource || !photoUrl)) {
    photoUrl = isTemporaryAirtableImage(source.url)
      ? await storeAirtableImage(row.client_id, record.id, source.url)
      : source.url;
  }
  // Airtable does not carry every field (a migrated product's SKU and Shopify selling
  // price, or values set in the app): an empty Airtable cell never erases ours.
  const keep = <T,>(fromAirtable: T | null | undefined, current: T | null | undefined) =>
    fromAirtable == null || fromAirtable === "" ? (current ?? null) : fromAirtable;
  // The lifecycle is computed by the app from Shopify sales (classifyAllProducts) and
  // pushed to Airtable from there: Airtable never overrides it once the product exists.
  // A product migrated from an existing Shopify store has nothing to source either.
  const migrated = String(existing?.migration_state ?? "").startsWith("imported");
  const merged = {
    ...row,
    sku: keep(row.sku, existing?.sku),
    lifecycle_status: existing?.lifecycle_status ?? row.lifecycle_status,
    sourcing_status: migrated
      ? (existing?.sourcing_status ?? row.sourcing_status)
      : row.sourcing_status,
    selling_price: keep(row.selling_price, existing?.selling_price),
    weight_g: keep(row.weight_g, existing?.weight_g),
    shipping_channel: keep(row.shipping_channel, existing?.shipping_channel),
    production_lead_days: keep(row.production_lead_days, existing?.production_lead_days),
    moq: keep(row.moq, existing?.moq),
    client_price: keep(row.client_price, existing?.client_price),
    stock_manual: keep(row.stock_manual, existing?.stock_manual),
    id: existing?.id ?? randomUUID(),
    photo_url: photoUrl,
    quote_json: {
      ...existingQuote,
      ...row.quote_json,
      _request: keepAppMarkets(existingQuote._request, row.quote_json._request, migrated),
      _photo_source: source?.id ?? previousSource,
    },
  };
  const { error } = await admin
    .from("products_cache")
    .upsert(merged, { onConflict: "airtable_record_id" });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

export async function reconcileAirtableProducts() {
  const config = getAirtableConfig();
  if (!config.configured) return { scanned: 0, synced: 0, skipped: true };
  const records = await listAirtableRecords(config.productsTable);
  let synced = 0;
  for (const record of records) {
    const result = await syncAirtableRecord(record);
    if (result.ok) synced += 1;
  }
  return { scanned: records.length, synced, skipped: false };
}

export async function pushPendingProducts() {
  const config = getAirtableConfig();
  if (!config.configured) return { scanned: 0, pushed: 0, skipped: true };
  const admin = createAdminClient();
  const { data } = await admin
    .from("products_cache")
    .select("*, clients!inner(name, airtable_client_record_id)")
    .like("airtable_record_id", "pending:%")
    .limit(50);
  let pushed = 0;
  for (const row of data ?? []) {
    const requestRaw = row.quote_json?._request;
    const request =
      requestRaw && typeof requestRaw === "object" ? (requestRaw as ProductRequest) : {};
    const record = await createAirtableProduct({
      clientId: row.client_id,
      clientName: row.clients?.name,
      airtableClientRecordId: row.clients?.airtable_client_record_id,
      title: row.title,
      photoUrl: row.photo_url,
      request,
    });
    await admin
      .from("products_cache")
      .update({
        airtable_record_id: record.id,
        quote_json: {
          ...(row.quote_json ?? {}),
          _sync: { status: "synced" },
        },
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("client_id", row.client_id);
    pushed += 1;
  }
  return { scanned: (data ?? []).length, pushed, skipped: false };
}
