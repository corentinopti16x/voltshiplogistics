-- One Shopify app (custom distribution) per merchant store.
-- Shopify only lets a custom-distribution app be installed on a single store, so each
-- client store gets its own app in the Voltship Partner organisation. Its client ID and
-- (encrypted) client secret are stored here, keyed by the store's myshopify domain.
-- Stores without a row fall back to the global SHOPIFY_API_KEY / SHOPIFY_API_SECRET.

create table if not exists public.shopify_app_credentials (
  shopify_domain text primary key,
  api_key text not null,
  api_secret_encrypted text not null,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shopify_app_credentials enable row level security;
-- No policies: only the service role (server) reads or writes this table.
