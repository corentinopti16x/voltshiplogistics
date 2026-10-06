-- The client a store's dedicated Shopify app belongs to: when the merchant installs the
-- app from its install link, the shop is attached to this client automatically.
alter table public.shopify_app_credentials
  add column if not exists client_id uuid references public.clients (id) on delete set null;
