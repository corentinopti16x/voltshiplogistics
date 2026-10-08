/**
 * "À compléter" — pure logic (unit-tested). A Shopify product is complete for Voltship
 * when it is linked to a Voltship product that has a weight, a client price, a shipping
 * channel and a factory price. Products that sold in the last 90 days are mandatory
 * (their orders cannot be priced otherwise); products without sales are optional.
 */

export type TodoField = "link" | "weight" | "client_price" | "channel" | "factory_price";

export type ShopifyVariantLite = {
  id: string;
  client_id: string;
  shop_id: string;
  shopify_product_id: string;
  title: string;
  sku: string | null;
  photo_url: string | null;
  units_90d: number | null;
  imported_product_id: string | null;
};

export type VoltshipProductLite = {
  id: string;
  client_id: string;
  title: string;
  sku: string | null;
  weight_g: number | null;
  client_price: number | null;
  shipping_channel: string | null;
  factory_purchase_price: number | null;
  /** Shopify SKUs mapped to this product (sku_maps). */
  mapped_skus: string[];
};

export type TodoItem = {
  key: string;
  clientId: string;
  shopId: string;
  shopifyProductId: string;
  title: string;
  photoUrl: string | null;
  skus: string[];
  units90d: number;
  priority: "required" | "optional";
  productId: string | null;
  missing: TodoField[];
};

export function missingFields(product: VoltshipProductLite | null): TodoField[] {
  if (!product) return ["link", "weight", "client_price", "channel", "factory_price"];
  const missing: TodoField[] = [];
  if (!product.weight_g || product.weight_g <= 0) missing.push("weight");
  if (product.client_price == null || product.client_price <= 0) missing.push("client_price");
  if (!product.shipping_channel) missing.push("channel");
  if (product.factory_purchase_price == null || product.factory_purchase_price <= 0) missing.push("factory_price");
  return missing;
}

function norm(sku: string | null | undefined) {
  return (sku ?? "").trim().toLowerCase();
}

/** Groups variants per Shopify product and resolves the Voltship product (import link, then SKU). */
export function buildTodo(variants: ShopifyVariantLite[], products: VoltshipProductLite[]): TodoItem[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const bySku = new Map<string, VoltshipProductLite>();
  for (const product of products) {
    for (const sku of [product.sku, ...product.mapped_skus]) {
      const key = norm(sku);
      if (key) bySku.set(`${product.client_id}|${key}`, product);
    }
  }
  const groups = new Map<string, ShopifyVariantLite[]>();
  for (const variant of variants) {
    const key = `${variant.shop_id}:${variant.shopify_product_id}`;
    groups.set(key, [...(groups.get(key) ?? []), variant]);
  }
  const items: TodoItem[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    let product: VoltshipProductLite | null = null;
    for (const variant of group) {
      product =
        (variant.imported_product_id ? byId.get(variant.imported_product_id) : undefined) ??
        (norm(variant.sku) ? bySku.get(`${variant.client_id}|${norm(variant.sku)}`) : undefined) ??
        null;
      if (product) break;
    }
    const missing = missingFields(product);
    if (missing.length === 0) continue;
    const units = group.reduce((sum, variant) => sum + Math.max(0, Number(variant.units_90d) || 0), 0);
    items.push({
      key,
      clientId: first.client_id,
      shopId: first.shop_id,
      shopifyProductId: first.shopify_product_id,
      title: first.title,
      photoUrl: group.find((variant) => variant.photo_url)?.photo_url ?? null,
      skus: [...new Set(group.map((variant) => variant.sku?.trim()).filter((sku): sku is string => Boolean(sku)))],
      units90d: units,
      priority: units > 0 ? "required" : "optional",
      productId: product?.id ?? null,
      missing,
    });
  }
  return items.sort(
    (a, b) =>
      (a.priority === b.priority ? 0 : a.priority === "required" ? -1 : 1) ||
      b.units90d - a.units90d ||
      a.title.localeCompare(b.title),
  );
}

function tokens(text: string) {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9一-鿿]+/)
      .filter((token) => token.length > 1),
  );
}

/** 0..1 word overlap (Jaccard) — used to suggest which quoted product a Shopify product is. */
export function titleSimilarity(a: string, b: string) {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common += 1;
  return common / (left.size + right.size - common);
}

/** Candidates of the same client, best title match first (only the plausible ones flagged). */
export function rankLinkCandidates<T extends { id: string; title: string }>(title: string, candidates: T[]) {
  return candidates
    .map((candidate) => ({ ...candidate, score: titleSimilarity(title, candidate.title) }))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

/** Voltship SKU given to a quoted product so the client can reuse it on Shopify: VS-<CODE>-001. */
export function nextVoltshipSku(clientCode: string | null | undefined, existing: Array<string | null>) {
  const code = (clientCode ?? "CLIENT").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12) || "CLIENT";
  const prefix = `VS-${code}-`;
  let max = 0;
  for (const sku of existing) {
    if (!sku?.toUpperCase().startsWith(prefix)) continue;
    const n = Number(sku.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}
