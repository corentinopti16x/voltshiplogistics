import type { ShippingChannel } from "@/lib/domain/pricing";
import type { ProductAttributes } from "@/lib/products/attributes";

export type LifecycleStatus =
  | "testing"
  | "winning"
  | "declining"
  | "dead"
  | "archived";

export type SourcingStatus =
  | "brief_received"
  | "factories"
  | "samples"
  | "negotiation"
  | "quote_sent"
  | "validated"
  | "in_production"
  | "in_stock"
  | "flagged";

export type ProductRequest = {
  description?: string;
  source_url?: string;
  target_unit_price?: number | null;
  expected_launch_qty?: number | null;
  destination_markets?: string;
  notes?: string;
  /** Raw answers of the product-nature questions (see lib/products/attributes). */
  attributes?: Partial<ProductAttributes>;
  /** Channel derived from `attributes` at creation; the sourcer's `shipping_channel` wins. */
  suggested_channel?: ShippingChannel;
  /** Client-declared approximate unit weight (g), used only for the early estimate. */
  approx_weight_g?: number | null;
  /** What the client pays today per unit at their agent, used only for the early estimate. */
  current_unit_cost?: number | null;
};

export type ProductRow = {
  id: string;
  client_id: string;
  airtable_record_id: string;
  sku: string | null;
  title: string;
  photo_url: string | null;
  created_date: string | null;
  lifecycle_status: LifecycleStatus | null;
  sourcing_status: SourcingStatus | null;
  quote_json: Record<string, unknown> | null;
  accepted_quote_snapshot_json: Record<string, unknown> | null;
  selling_price: number | null;
  weight_g: number | null;
  shipping_channel: string | null;
  production_lead_days: number | null;
  moq: number | null;
  client_price: number | null;
  stock_manual: number | null;
  migration_state: string | null;
  last_synced_at: string | null;
  created_at: string;
};

export const SOURCING_PIPELINE: SourcingStatus[] = [
  "brief_received",
  "factories",
  "samples",
  "negotiation",
  "validated",
  "in_production",
  "in_stock",
];

export type ProductQuestion = {
  text: string;
  at: string;
};

export type ResearchKind = "brief" | "reddit" | "personas";

export type ResearchPersona = {
  name: string;
  role: string;
  need: string;
  hook: string;
};

export type ResearchBlock = {
  status: "not_generated" | "generating" | "ready";
  requested_at?: string;
  ready_at?: string;
  title?: string;
  summary?: string;
  bullets?: string[];
  cards?: ResearchPersona[];
  url?: string;
  error?: string;
};

export type ResearchState = Record<ResearchKind, ResearchBlock>;

export type RestockRequest = {
  qty: number | null;
  notes: string;
  at: string;
};

export const RESEARCH_KINDS: ResearchKind[] = ["brief", "reddit", "personas"];

export function getProductRequest(product: ProductRow): ProductRequest {
  const raw = product.quote_json?._request;
  if (!raw || typeof raw !== "object") return {};
  return raw as ProductRequest;
}

export function getProductQuestions(product: ProductRow): ProductQuestion[] {
  const raw = product.quote_json?._questions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is ProductQuestion => {
    return (
      !!item &&
      typeof item === "object" &&
      typeof (item as ProductQuestion).text === "string"
    );
  });
}

function parseResearchBlock(raw: unknown): ResearchBlock {
  if (!raw || typeof raw !== "object") return { status: "not_generated" };
  const row = raw as ResearchBlock;
  const bullets = Array.isArray(row.bullets)
    ? row.bullets.filter((item): item is string => typeof item === "string")
    : undefined;
  const cards = Array.isArray(row.cards)
    ? row.cards.filter((item): item is ResearchPersona => {
        return !!item && typeof item === "object" && typeof item.name === "string";
      })
    : undefined;
  if (row.status === "ready" || row.status === "generating") {
    return {
      ...row,
      bullets,
      cards,
    };
  }
  return { status: "not_generated" };
}

export function getResearchState(product: ProductRow): ResearchState {
  const raw =
    product.quote_json?._research && typeof product.quote_json._research === "object"
      ? (product.quote_json._research as Record<string, unknown>)
      : {};
  return {
    brief: parseResearchBlock(raw.brief),
    reddit: parseResearchBlock(raw.reddit),
    personas: parseResearchBlock(raw.personas),
  };
}

export function getRestockRequests(product: ProductRow): RestockRequest[] {
  const raw = product.quote_json?._restocks;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is RestockRequest => {
    return !!item && typeof item === "object" && typeof (item as RestockRequest).at === "string";
  });
}

export function isQuoteReady(product: ProductRow) {
  return product.weight_g != null && !!product.shipping_channel && product.client_price != null;
}

export function isQuoteAccepted(product: ProductRow) {
  return product.accepted_quote_snapshot_json != null;
}

export function isSourcingOpen(status: SourcingStatus | null) {
  return (
    status != null &&
    status !== "in_stock" &&
    status !== "validated" &&
    status !== "in_production"
  );
}
