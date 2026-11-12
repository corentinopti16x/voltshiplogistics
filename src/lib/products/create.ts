import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAirtableConfig } from "@/lib/airtable/config";
import { createAirtableProduct } from "@/lib/airtable/products";
import type { ProductRequest } from "@/lib/products/types";
import { deriveSuggestedChannel, type ProductAttributes } from "@/lib/products/attributes";

/**
 * Creates a product request for one client from the « new product » form: same record
 * whether the client fills it or the team does it for them. The caller checks the rights.
 */
export async function createProductFromForm(
  clientId: string,
  formData: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
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
  const optionalNumber = (name: string) => {
    const raw = String(formData.get(name) ?? "").trim();
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  // Product-nature questions (checkboxes) → raw booleans + suggested shipping channel.
  const liquid = formData.get("attr_liquid") === "on";
  const attributes: ProductAttributes = {
    electronics: formData.get("attr_electronics") === "on",
    liquid,
    alcohol: liquid && formData.get("attr_alcohol") === "on",
    ingestible: formData.get("attr_ingestible") === "on",
    magnetic: formData.get("attr_magnetic") === "on",
  };

  if (title.length < 2) return { ok: false, error: "Indique le nom du produit." };
  const hasPhoto = photo instanceof File && photo.size > 0;
  if (!hasPhoto && !sourceUrl) {
    return { ok: false, error: "Ajoute une photo ou un lien du produit (au moins l'un des deux)." };
  }
  if (!destinations) return { ok: false, error: "Indique au moins un marché de destination (ex. FR)." };

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
    attributes,
    suggested_channel: deriveSuggestedChannel(attributes),
    approx_weight_g: optionalNumber("approx_weight_g"),
    current_unit_cost: optionalNumber("current_unit_cost"),
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
    const path = `${clientId}/${id}/product.${extension}`;
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
      .eq("id", clientId)
      .maybeSingle();
    try {
      const record = await createAirtableProduct({
        clientId: clientId,
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
      client_id: clientId,
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
  return { ok: true, id: data.id as string };

}
