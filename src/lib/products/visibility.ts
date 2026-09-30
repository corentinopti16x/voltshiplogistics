import type { ProductRow } from "./types";

export const CLIENT_PRODUCT_COLUMNS = [
  "id",
  "client_id",
  "airtable_record_id",
  "sku",
  "title",
  "photo_url",
  "created_date",
  "lifecycle_status",
  "sourcing_status",
  "quote_json",
  "accepted_quote_snapshot_json",
  "selling_price",
  "weight_g",
  "shipping_channel",
  "production_lead_days",
  "moq",
  "client_price",
  "stock_manual",
  "migration_state",
  "last_synced_at",
  "created_at",
] as const;

export const CLIENT_PRODUCT_SELECT =
  "id,client_id,airtable_record_id,sku,title,photo_url,created_date,lifecycle_status,sourcing_status,quote_json,accepted_quote_snapshot_json,selling_price,weight_g,shipping_channel,production_lead_days,moq,client_price,stock_manual,migration_state,last_synced_at,created_at";

export function serializeClientProduct(input: Record<string, unknown>): ProductRow {
  return Object.fromEntries(
    CLIENT_PRODUCT_COLUMNS.map((column) => [column, input[column] ?? null]),
  ) as ProductRow;
}

export function assertNoInternalProductFields(input: Record<string, unknown>) {
  const forbidden = [
    "factory_purchase_price",
    "supplier_name",
    "supplier_contact",
    "sourcing_location",
    "internal_notes",
  ];
  return forbidden.every((field) => !(field in input));
}
