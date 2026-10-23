-- Anti-doublon ECCANG (24 Oct 2026)
-- Run in the Supabase SQL editor AFTER 00023. Safe to re-run.
--
-- The same Shopify order can exist twice in ECCANG (file import + Shopify sync). The sync
-- reports each duplicate once: duplicate_alerted_at marks the copies already reported.

alter table public.eccang_orders
  add column if not exists duplicate_alerted_at timestamptz;

comment on column public.eccang_orders.duplicate_alerted_at is
  'Set when this order was reported as a duplicate of another ECCANG order for the same Shopify order (external_ref).';

create index if not exists eccang_orders_external_ref_idx
  on public.eccang_orders (client_id, external_ref)
  where external_ref is not null;
