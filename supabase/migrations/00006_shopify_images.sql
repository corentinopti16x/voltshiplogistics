-- Voltship Client App — Shopify product images + anonymised customer key on orders.
-- Run after 00005_orders_cache_rls.sql.

-- Up to 4 product image URLs (page order, variant image first) hot-linked from Shopify.
-- photo_url keeps the first image for backward compatibility.
alter table public.shopify_products_cache
  add column if not exists images_json jsonb not null default '[]'::jsonb;

-- SHA-256 of the Shopify customer id (or of the lowercased e-mail when the id is
-- missing). The raw e-mail is never stored; null when the order carries neither.
alter table public.shopify_orders_cache
  add column if not exists customer_key text;

create index if not exists shopify_orders_customer_idx
  on public.shopify_orders_cache (client_id, customer_key);
