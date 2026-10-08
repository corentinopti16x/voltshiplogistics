-- Products created automatically from Shopify (autoImport / reconcile).
alter type public.migration_state add value if not exists 'imported_auto';

-- SKU as typed on Shopify; `sku` keeps the effective SKU Voltship uses (own SKU, or
-- SHOPIFY-<variant id> when missing / shared by a different item / split by the admin).
alter table public.shopify_products_cache
  add column if not exists shopify_sku text,
  add column if not exists sku_split boolean not null default false;
