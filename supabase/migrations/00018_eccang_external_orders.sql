-- Orders a client creates himself in ECCANG (his own API key / ECCANG UI) are imported
-- too, so Voltship sees and bills every parcel. reference_no = "ECC-<order_code>" for them.

alter table public.eccang_orders
  add column if not exists source text not null default 'voltship',
  add column if not exists external_ref text,
  add column if not exists items_json jsonb,
  add column if not exists eccang_created_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'eccang_orders_source_check') then
    alter table public.eccang_orders
      add constraint eccang_orders_source_check check (source in ('voltship', 'external'));
  end if;
end $$;

comment on column public.eccang_orders.source is
  'voltship = pushed by the app from Shopify · external = created by the client in ECCANG (own API key / UI)';
comment on column public.eccang_orders.items_json is
  'External orders only: [{sku, quantity}] from ECCANG (pushed orders take their lines from Shopify).';

create index if not exists eccang_orders_source_idx
  on public.eccang_orders (client_id, source);
