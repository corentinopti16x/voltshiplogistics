import "server-only";

import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAirtableConfig } from "@/lib/airtable/config";
import { createAirtableProduct } from "@/lib/airtable/products";
import { groupListings, normSku, pickKeeper } from "@/lib/shopify/sku-groups";

export type ShopifyCacheVariant = {
  id: string;
  client_id: string;
  shop_id: string;
  shopify_product_id: string;
  title: string;
  sku: string | null;
  photo_url: string | null;
  clients?: { name?: string | null; airtable_client_record_id?: string | null } | null;
};

/**
 * One Voltship product (status "à compléter") from all variants of one Shopify product;
 * every variant SKU is mapped to it (sku_maps) and the cache rows point to it.
 */
export async function importShopifyVariantGroup(
  variants: ShopifyCacheVariant[],
  options: { auto?: boolean } = {},
): Promise<{ ok: true; productId: string } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const row = variants[0];
  const id = randomUUID();
  const request = {
    description: `Imported from Shopify product ${row.shopify_product_id} (${variants.length} variant(s)).`,
    destination_markets: "FR",
    notes: "Winning-product migration. Sourcer backfill required.",
  };
  let airtableRecordId = `pending:${id}`;
  // Automatic imports (every sync) stay out of Airtable: it is only a mirror and a store
  // can have hundreds of products.
  if (!options.auto && getAirtableConfig().configured) {
    try {
      const record = await createAirtableProduct({
        clientId: row.client_id,
        clientName: row.clients?.name,
        airtableClientRecordId: row.clients?.airtable_client_record_id,
        title: row.title,
        photoUrl: row.photo_url,
        request,
      });
      airtableRecordId = record.id;
    } catch (airtableError) {
      return {
        ok: false as const,
        error:
          airtableError instanceof Error
            ? airtableError.message
            : "Could not create migrated Airtable product.",
      };
    }
  }

  const { error: insertError } = await admin.from("products_cache").insert({
    id,
    client_id: row.client_id,
    airtable_record_id: airtableRecordId,
    sku: variants.find((v) => v.sku)?.sku ?? null,
    title: row.title,
    photo_url: variants.find((v) => v.photo_url)?.photo_url ?? null,
    created_date: new Date().toISOString().slice(0, 10),
    // Auto-imported products start as "testing": the lifecycle classifier then promotes
    // them from their real Shopify sales (a manual import means "this one sells").
    lifecycle_status: options.auto ? "testing" : "winning",
    sourcing_status: "validated",
    migration_state: options.auto ? "imported_auto" : "imported_pending",
    quote_json: {
      _request: request,
      _sync: {
        status: airtableRecordId.startsWith("pending:") ? "pending" : "synced",
      },
    },
  });
  if (insertError) return { ok: false as const, error: insertError.message };
  for (const variant of variants) {
    await admin
      .from("shopify_products_cache")
      .update({ imported_product_id: id })
      .eq("id", variant.id)
      .eq("client_id", variant.client_id);
    if (variant.sku) {
      await admin.from("sku_maps").upsert(
        {
          client_id: variant.client_id,
          shop_id: variant.shop_id,
          shopify_sku: variant.sku,
          airtable_record_id: airtableRecordId,
        },
        { onConflict: "client_id,shop_id,shopify_sku" },
      );
    }
  }
  return { ok: true, productId: id };
}

type ReconcileVariant = ShopifyCacheVariant & { status: string | null; imported_product_id: string | null };

type ReconcileProduct = {
  id: string;
  sku: string | null;
  airtable_record_id: string;
  migration_state: string | null;
  lifecycle_status: string | null;
  client_price: number | null;
  weight_g: number | null;
  shipping_channel: string | null;
  created_at: string;
};

async function pageRows<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function isLive(product: Pick<ReconcileProduct, "migration_state" | "lifecycle_status">) {
  return product.migration_state !== "ignored" && product.lifecycle_status !== "archived";
}

/**
 * One Voltship product per real item, for the whole client (every shop at once):
 *  - Shopify listings sharing an (effective) SKU — duplicate pages, A/B tests, the same item
 *    in several stores — are one product; new listings / variants join it automatically;
 *  - a listing whose SKU is unknown becomes a new product ("à compléter");
 *  - duplicates created automatically and still empty are merged into the kept product
 *    (archived, never deleted); products filled by hand are never touched;
 *  - an automatic product left without any listing (re-linked elsewhere) is archived.
 */
export async function reconcileClientProducts(input: { clientId: string; limit?: number }) {
  const admin = createAdminClient();
  const clientId = input.clientId;
  const [variants, products, maps] = await Promise.all([
    pageRows<ReconcileVariant>((from, to) =>
      admin
        .from("shopify_products_cache")
        .select("id, client_id, shop_id, shopify_product_id, title, sku, photo_url, status, imported_product_id")
        .eq("client_id", clientId)
        .order("id")
        .range(from, to),
    ),
    pageRows<ReconcileProduct>((from, to) =>
      admin
        .from("products_cache")
        .select("id, sku, airtable_record_id, migration_state, lifecycle_status, client_price, weight_g, shipping_channel, created_at")
        .eq("client_id", clientId)
        .order("id")
        .range(from, to),
    ),
    pageRows<{ shop_id: string | null; shopify_sku: string | null; airtable_record_id: string | null }>((from, to) =>
      admin
        .from("sku_maps")
        .select("shop_id, shopify_sku, airtable_record_id")
        .eq("client_id", clientId)
        .order("id")
        .range(from, to),
    ),
  ]);
  const live = new Map(products.filter(isLive).map((product) => [product.id, product]));
  const liveIds = [...live.keys()];

  // Filled in (factory price) or used elsewhere (purchase orders, inbounds) = never merged away.
  const withFactory = new Set<string>();
  const referenced = new Set<string>();
  for (let i = 0; i < liveIds.length; i += 300) {
    const ids = liveIds.slice(i, i + 300);
    const [{ data: work }, { data: pos }, { data: inbounds }] = await Promise.all([
      admin.from("sourcing_work").select("product_id, factory_purchase_price").in("product_id", ids),
      admin.from("purchase_orders").select("product_id").in("product_id", ids),
      admin.from("inbound_cache").select("product_id").in("product_id", ids),
    ]);
    for (const row of work ?? []) if (Number(row.factory_purchase_price) > 0) withFactory.add(row.product_id);
    for (const row of [...(pos ?? []), ...(inbounds ?? [])]) if (row.product_id) referenced.add(row.product_id);
  }
  const hasData = (product: ReconcileProduct) =>
    (Number(product.client_price) || 0) > 0 ||
    (Number(product.weight_g) || 0) > 0 ||
    Boolean(product.shipping_channel) ||
    withFactory.has(product.id);
  const isAuto = (product: ReconcileProduct) => product.migration_state === "imported_auto";
  const disposable = (product: ReconcileProduct) => isAuto(product) && !hasData(product) && !referenced.has(product.id);

  const byRecord = new Map([...live.values()].map((product) => [product.airtable_record_id, product]));
  const owner = new Map<string, ReconcileProduct>();
  for (const product of live.values()) if (product.sku) owner.set(normSku(product.sku), product);
  for (const map of maps) {
    const product = map.airtable_record_id ? byRecord.get(map.airtable_record_id) : undefined;
    if (product && map.shopify_sku) owner.set(normSku(map.shopify_sku), product);
  }
  const mapKey = (shopId: string | null, sku: string) => `${shopId ?? ""}|${sku}`;
  const currentMap = new Map(
    maps
      .filter((map) => map.shopify_sku)
      .map((map) => [mapKey(map.shop_id, map.shopify_sku as string), map.airtable_record_id]),
  );

  const active = variants.filter((variant) => !variant.status || variant.status === "active");
  const byListing = new Map<string, ReconcileVariant[]>();
  for (const variant of active) {
    const key = `${variant.shop_id}:${variant.shopify_product_id}`;
    byListing.set(key, [...(byListing.get(key) ?? []), variant]);
  }
  const finalLink = new Map(variants.map((variant) => [variant.id, variant.imported_product_id]));
  const archived = new Set<string>();
  let created = 0;
  let linked = 0;
  let merged = 0;

  const archive = async (loser: ReconcileProduct, keeper: ReconcileProduct | null) => {
    if (archived.has(loser.id)) return;
    archived.add(loser.id);
    // Its SKU is released so a SKU always resolves to one live product (kept in the request notes).
    await admin
      .from("products_cache")
      .update({ lifecycle_status: "archived", migration_state: "ignored", sku: null })
      .eq("id", loser.id)
      .eq("client_id", clientId);
    if (keeper && !keeper.sku && loser.sku) {
      keeper.sku = loser.sku;
      await admin.from("products_cache").update({ sku: loser.sku }).eq("id", keeper.id).is("sku", null);
    }
    if (keeper) {
      await admin
        .from("sku_maps")
        .update({ airtable_record_id: keeper.airtable_record_id })
        .eq("client_id", clientId)
        .eq("airtable_record_id", loser.airtable_record_id);
    }
  };

  for (const listingKeys of groupListings(active.map((v) => ({ shopId: v.shop_id, shopifyProductId: v.shopify_product_id, sku: v.sku })))) {
    // Oldest listing first: its title names a new product.
    const group = listingKeys
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .flatMap((key) => byListing.get(key) ?? []);
    if (group.length === 0) continue;

    const candidates = [
      ...new Map(
        group
          .map((variant) => (variant.imported_product_id ? live.get(variant.imported_product_id) : undefined))
          .filter((product): product is ReconcileProduct => Boolean(product) && !archived.has(product!.id))
          .map((product) => [product.id, product]),
      ).values(),
    ];
    if (candidates.length === 0) {
      // Not linked yet: a product already owning one of the SKUs (quoted before the client created it on Shopify).
      for (const variant of group) {
        const product = variant.sku ? owner.get(normSku(variant.sku)) : undefined;
        if (product && !archived.has(product.id) && !candidates.some((c) => c.id === product.id)) candidates.push(product);
      }
    }
    if (candidates.length === 0) {
      if (created >= (input.limit ?? 150)) continue;
      const result = await importShopifyVariantGroup(group, { auto: true });
      if (result.ok) {
        created += 1;
        for (const variant of group) finalLink.set(variant.id, result.productId);
      }
      continue;
    }

    const keeper = pickKeeper(
      candidates.map((product) => ({
        ...product,
        auto: isAuto(product),
        hasData: hasData(product),
        createdAt: product.created_at,
      })),
    )!;
    const losers = candidates.filter((product) => product.id !== keeper.id && disposable(product));
    const loserIds = new Set(losers.map((product) => product.id));
    for (const variant of group) {
      const current = variant.imported_product_id;
      const keep = current && current !== keeper.id && live.has(current) && !loserIds.has(current) && !archived.has(current);
      if (keep) continue; // linked by hand to another product: respected
      if (current !== keeper.id) {
        await admin
          .from("shopify_products_cache")
          .update({ imported_product_id: keeper.id })
          .eq("id", variant.id)
          .eq("client_id", clientId);
        finalLink.set(variant.id, keeper.id);
        linked += 1;
      }
      if (variant.sku && currentMap.get(mapKey(variant.shop_id, variant.sku)) !== keeper.airtable_record_id) {
        await admin.from("sku_maps").upsert(
          {
            client_id: clientId,
            shop_id: variant.shop_id,
            shopify_sku: variant.sku,
            airtable_record_id: keeper.airtable_record_id,
          },
          { onConflict: "client_id,shop_id,shopify_sku" },
        );
        currentMap.set(mapKey(variant.shop_id, variant.sku), keeper.airtable_record_id);
      }
    }
    for (const loser of losers) {
      await archive(loser, keeper);
      merged += 1;
    }
  }

  // Automatic products no Shopify variant points to any more (re-linked to another product).
  const stillLinked = new Set([...finalLink.values()].filter(Boolean));
  for (const product of live.values()) {
    if (archived.has(product.id) || stillLinked.has(product.id) || !disposable(product)) continue;
    await archive(product, null);
    merged += 1;
  }
  return { created, linked, merged };
}

/** Kept for the existing call sites (sync, OAuth callback, "Synchroniser"): reconciles the whole client. */
export async function autoImportShopProducts(input: { clientId: string; shopId: string; limit?: number }) {
  return reconcileClientProducts({ clientId: input.clientId, limit: input.limit });
}
