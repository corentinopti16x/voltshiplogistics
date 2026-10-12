import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchVariantDetails, updateVariantSkus } from "./admin-api";
import { isFallbackSku } from "./sku";
import { isServiceLine, proposeSkus, skuError, type SkuFixKind } from "./sku-fix-core";
import { parseShopMarkets } from "./shop-markets";
import { refreshClientEffectiveSkus } from "./sku-resolve";
import { accessTokenForConnectedShop } from "./sync";

type ShopRow = {
  id: string;
  client_id: string;
  shopify_domain: string;
  access_token_encrypted: string | null;
  market: string | null;
  clients: { name: string; code: string | null } | Array<{ name: string; code: string | null }>;
};

type VariantRow = {
  id: string;
  client_id: string;
  shop_id: string;
  shopify_product_id: string;
  shopify_variant_id: string;
  title: string;
  sku: string | null;
  shopify_sku: string | null;
  sku_split: boolean | null;
  units_90d: number | null;
  imported_product_id: string | null;
  photo_url: string | null;
  status: string | null;
};

export type SkuFixItem = {
  key: string;
  clientId: string;
  clientName: string;
  shopId: string;
  shopDomain: string;
  shopifyProductId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string | null;
  photoUrl: string | null;
  units90d: number;
  kind: SkuFixKind;
  /** SKU written on Shopify today (null: none). */
  currentSku: string | null;
  /** Other items of the client that carry the same Shopify SKU. */
  sharedWith: string[];
  proposal: string;
  /** Fixed on Shopify since the last sync: nothing to do. */
  alreadyFixed: boolean;
  /** Shipping insurance, free shipping…: not goods, not ticked by default. */
  service: boolean;
};

export type SkuFixList = {
  items: SkuFixItem[];
  clients: Array<{ id: string; name: string }>;
  total: number;
  sold: number;
  liveErrors: string[];
};

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error?: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function clientOf(shop: ShopRow) {
  return Array.isArray(shop.clients) ? shop.clients[0] : shop.clients;
}

async function loadShops() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("shops")
    .select("id, client_id, shopify_domain, access_token_encrypted, market, clients!inner(name, code)")
    .eq("status", "active");
  if (error) throw error;
  return (data ?? []) as ShopRow[];
}

/** Every SKU in use (all clients, all stores, Voltship products), uppercase. */
async function loadAllSkus() {
  const admin = createAdminClient();
  const variants = await pageAll<{ shopify_sku: string | null }>((from, to) =>
    admin.from("shopify_products_cache").select("shopify_sku").not("shopify_sku", "is", null).order("id").range(from, to),
  );
  const products = await pageAll<{ sku: string | null }>((from, to) =>
    admin.from("products_cache").select("sku").not("sku", "is", null).order("id").range(from, to),
  );
  const out = new Set<string>();
  for (const row of [...variants.map((v) => v.shopify_sku), ...products.map((p) => p.sku)]) {
    const sku = row?.trim().toUpperCase();
    if (sku && !isFallbackSku(sku)) out.add(sku);
  }
  return out;
}

/** Variants that still sold in the last 90 days and need a SKU fix (badge count). */
export async function countSkuFixes() {
  const admin = createAdminClient();
  const { count } = await admin
    .from("shopify_products_cache")
    .select("id", { count: "exact", head: true })
    .like("sku", "SHOPIFY-%")
    .eq("status", "active")
    .gt("units_90d", 0);
  return count ?? 0;
}

/**
 * Every active Shopify variant without a usable SKU: none at all, or the SKU of another item
 * (the app then shows a `SHOPIFY-…` code). Sold ones first. Variant titles and current SKUs
 * are read live from Shopify for the listed variants (at most `limit`).
 */
export async function loadSkuFixList(options: { clientId?: string | null; all?: boolean; limit?: number } = {}): Promise<SkuFixList> {
  const admin = createAdminClient();
  const shops = (await loadShops()).filter((shop) => !options.clientId || shop.client_id === options.clientId);
  const allShops = await loadShops();
  const clients = [...new Map(allShops.map((shop) => [shop.client_id, clientOf(shop)?.name ?? "?"])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (shops.length === 0) return { items: [], clients, total: 0, sold: 0, liveErrors: [] };
  const shopById = new Map(shops.map((shop) => [shop.id, shop]));
  const clientIds = [...new Set(shops.map((shop) => shop.client_id))];

  const catalogue = await pageAll<VariantRow>((from, to) =>
    admin
      .from("shopify_products_cache")
      .select(
        "id, client_id, shop_id, shopify_product_id, shopify_variant_id, title, sku, shopify_sku, sku_split, units_90d, imported_product_id, photo_url, status",
      )
      .in("client_id", clientIds)
      .order("id")
      .range(from, to),
  );
  const active = catalogue.filter((row) => row.status === "active" && shopById.has(row.shop_id));
  const broken = active
    .filter((row) => isFallbackSku(row.sku))
    .sort((a, b) => Number(b.units_90d ?? 0) - Number(a.units_90d ?? 0));
  const sold = broken.filter((row) => Number(row.units_90d ?? 0) > 0).length;
  const listed = (options.all ? broken : broken.filter((row) => Number(row.units_90d ?? 0) > 0)).slice(
    0,
    options.limit ?? 300,
  );

  // Live Shopify read (titles of options, current SKU), one batch per shop.
  const liveErrors: string[] = [];
  const live = new Map<string, { productTitle: string; variantTitle: string; sku: string | null }>();
  for (const shop of shops) {
    const ids = listed.filter((row) => row.shop_id === shop.id).map((row) => row.shopify_variant_id);
    if (ids.length === 0) continue;
    try {
      const token = await accessTokenForConnectedShop(shop);
      const details = await fetchVariantDetails(shop.shopify_domain, token, ids);
      for (const [variantId, detail] of details) live.set(`${shop.id}:${variantId}`, detail);
    } catch (error) {
      liveErrors.push(`${shop.shopify_domain}: ${error instanceof Error ? error.message : "lecture impossible"}`);
    }
  }

  // Who uses each real SKU of the client (to show the clash).
  const usersOfSku = new Map<string, Set<string>>();
  for (const row of catalogue) {
    const raw = row.shopify_sku?.trim();
    if (!raw) continue;
    const key = `${row.client_id}|${raw.toUpperCase()}`;
    const users = usersOfSku.get(key) ?? new Set<string>();
    users.add(row.title);
    usersOfSku.set(key, users);
  }

  // Neutral proposals (country + opaque code + option), never a SKU already used anywhere.
  const taken = await loadAllSkus();
  const inputs = listed.map((row) => {
    const shop = shopById.get(row.shop_id)!;
    const detail = live.get(`${row.shop_id}:${row.shopify_variant_id}`);
    return {
      key: row.id,
      country: parseShopMarkets(shop.market)[0] ?? "",
      groupKey: row.imported_product_id ?? `p:${row.shop_id}:${row.shopify_product_id}`,
      variantTitle: detail?.variantTitle ?? null,
    };
  });
  const proposals = proposeSkus(inputs, taken);

  const items: SkuFixItem[] = listed.map((row) => {
    const shop = shopById.get(row.shop_id)!;
    const detail = live.get(`${row.shop_id}:${row.shopify_variant_id}`);
    const currentSku = detail ? detail.sku : row.shopify_sku?.trim() || null;
    const kind: SkuFixKind = currentSku ? "shared" : "missing";
    const sharedWith = currentSku
      ? [...(usersOfSku.get(`${row.client_id}|${currentSku.toUpperCase()}`) ?? [])].filter((title) => title !== row.title)
      : [];
    return {
      key: row.id,
      clientId: row.client_id,
      clientName: clientOf(shop)?.name ?? "?",
      shopId: row.shop_id,
      shopDomain: shop.shopify_domain,
      shopifyProductId: row.shopify_product_id,
      variantId: row.shopify_variant_id,
      productTitle: detail?.productTitle ?? row.title,
      variantTitle: detail && !/^default title$/i.test(detail.variantTitle) ? detail.variantTitle : null,
      photoUrl: row.photo_url,
      units90d: Number(row.units_90d ?? 0),
      kind,
      currentSku,
      sharedWith,
      proposal: proposals.get(row.id) ?? "",
      // The SKU was changed on Shopify by someone else and no longer clashes: next sync fixes it.
      alreadyFixed: Boolean(detail && currentSku && currentSku !== (row.shopify_sku?.trim() || null) && sharedWith.length === 0),
      service: isServiceLine(detail?.productTitle ?? row.title),
    };
  });
  return { items, clients, total: broken.length, sold, liveErrors };
}

export type SkuFixResult = { written: number; failed: Array<{ title: string; error: string }> };

/**
 * Writes the chosen SKUs into Shopify, then updates the app: cached Shopify SKU, SKU map of the
 * Voltship product (the old code is kept so past sales stay attached), product SKU when it was
 * the old `SHOPIFY-…` code, and the client's effective SKUs.
 */
export async function applySkuFixes(picks: Array<{ key: string; sku: string }>): Promise<SkuFixResult> {
  const admin = createAdminClient();
  const result: SkuFixResult = { written: 0, failed: [] };
  const wanted = new Map(picks.map((pick) => [pick.key, pick.sku.trim()]));
  if (wanted.size === 0) return result;
  const rows: VariantRow[] = [];
  const keys = [...wanted.keys()];
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await admin
      .from("shopify_products_cache")
      .select(
        "id, client_id, shop_id, shopify_product_id, shopify_variant_id, title, sku, shopify_sku, sku_split, units_90d, imported_product_id, photo_url, status",
      )
      .in("id", keys.slice(i, i + 200));
    if (error) throw error;
    rows.push(...((data ?? []) as VariantRow[]));
  }

  const valid: VariantRow[] = [];
  for (const row of rows) {
    const error = skuError(wanted.get(row.id) ?? "");
    if (error) result.failed.push({ title: row.title, error: `SKU invalide (${error})` });
    else valid.push(row);
  }

  // A SKU must not land on two different items, whatever the client (same Voltship product is fine).
  const owners = new Map<string, Set<string>>();
  for (const row of valid) {
    const key = wanted.get(row.id)!.toUpperCase();
    const set = owners.get(key) ?? new Set<string>();
    set.add(row.imported_product_id ?? `p:${row.shop_id}:${row.shopify_product_id}`);
    owners.set(key, set);
  }
  const existing = await pageAll<{ shopify_sku: string | null; imported_product_id: string | null; shop_id: string; shopify_product_id: string }>((from, to) =>
    admin
      .from("shopify_products_cache")
      .select("shopify_sku, imported_product_id, shop_id, shopify_product_id")
      .not("shopify_sku", "is", null)
      .order("id")
      .range(from, to),
  );
  for (const row of existing) {
    const key = (row.shopify_sku ?? "").trim().toUpperCase();
    const set = owners.get(key);
    if (set) set.add(row.imported_product_id ?? `p:${row.shop_id}:${row.shopify_product_id}`);
  }
  const accepted = valid.filter((row) => {
    const clash = (owners.get(wanted.get(row.id)!.toUpperCase())?.size ?? 0) > 1;
    if (clash) result.failed.push({ title: row.title, error: `SKU « ${wanted.get(row.id)} » déjà utilisé par un autre produit` });
    return !clash;
  });

  const shops = new Map((await loadShops()).map((shop) => [shop.id, shop]));
  const byProduct = new Map<string, VariantRow[]>();
  for (const row of accepted) {
    const key = `${row.shop_id}|${row.shopify_product_id}`;
    byProduct.set(key, [...(byProduct.get(key) ?? []), row]);
  }
  const touchedClients = new Set<string>();
  for (const [key, group] of byProduct) {
    const [shopId, productId] = key.split("|");
    const shop = shops.get(shopId);
    if (!shop) {
      for (const row of group) result.failed.push({ title: row.title, error: "Boutique déconnectée" });
      continue;
    }
    try {
      const token = await accessTokenForConnectedShop(shop);
      const saved = await updateVariantSkus(
        shop.shopify_domain,
        token,
        productId,
        group.map((row) => ({ variantId: row.shopify_variant_id, sku: wanted.get(row.id)! })),
      );
      for (const row of group) {
        const sku = saved.get(row.shopify_variant_id) || wanted.get(row.id)!;
        await admin.from("shopify_products_cache").update({ shopify_sku: sku, sku_split: false }).eq("id", row.id);
        if (row.imported_product_id) {
          const { data: product } = await admin
            .from("products_cache")
            .select("id, sku, airtable_record_id")
            .eq("id", row.imported_product_id)
            .maybeSingle();
          if (product?.airtable_record_id) {
            await admin.from("sku_maps").upsert(
              { client_id: row.client_id, shop_id: row.shop_id, shopify_sku: sku, airtable_record_id: product.airtable_record_id },
              { onConflict: "client_id,shop_id,shopify_sku" },
            );
          }
          if (product && (!product.sku || product.sku === row.sku)) {
            await admin.from("products_cache").update({ sku }).eq("id", product.id);
          }
        }
        result.written += 1;
      }
      touchedClients.add(shop.client_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Écriture Shopify impossible";
      for (const row of group) result.failed.push({ title: row.title, error: message });
    }
  }
  for (const clientId of touchedClients) await refreshClientEffectiveSkus(clientId);
  return result;
}
