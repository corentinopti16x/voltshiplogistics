-- Delivery country of a Shopify store (ISO-2, e.g. IT for an Italian store): products
-- imported from it are priced for that market.
alter table public.shops
  add column if not exists market text;
