-- Voltship Client App — ECCANG WMS integration (go-live 8 Oct 2026)
-- Run in the Supabase SQL editor AFTER 00007. Safe to re-run.
--
-- * clients: one ECCANG appKey/appToken PER END CUSTOMER (no global key), the
--   warehouse code, the enabled flag and the last sync status.
-- * eccang_orders: one row per order pushed to ECCANG (reference_no = VS-<code>-<n>),
--   tracking, carrier, billed weight ("poids facturé" = order_weight) and fees.
-- * inbound_cache: extended so it can hold ECCANG ASNs (receiving orders).
-- * pricing_meta.eccang_shipping_methods: carrier/line → ECCANG shipping method code.

alter table public.clients
  add column if not exists eccang_app_key text,
  add column if not exists eccang_app_token_encrypted text,
  add column if not exists eccang_warehouse_code text,
  add column if not exists eccang_enabled boolean not null default false,
  add column if not exists eccang_last_sync_at timestamptz,
  add column if not exists eccang_sync_error text;

comment on column public.clients.eccang_app_token_encrypted is
  'AES-256-GCM (iv.tag.cipher, base64url) — ECCANG_TOKEN_ENCRYPTION_KEY or SHOPIFY_TOKEN_ENCRYPTION_KEY. Never returned to the browser.';

create table if not exists public.eccang_orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  shopify_order_id text,
  reference_no text not null unique,
  eccang_order_code text,
  status text not null default 'pending',
  tracking_no text,
  carrier_code text,
  shipping_method text,
  billed_weight_g integer,
  fee_json jsonb,
  last_payload jsonb,
  error text,
  pushed_at timestamptz,
  shipped_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.eccang_orders.status is
  'pending (not yet accepted) | C awaiting review | W awaiting shipment | D shipped | H held | N abnormal | P problem | X cancelled';
comment on column public.eccang_orders.billed_weight_g is
  'ECCANG order_weight (kg → g): the billed weight, actual or max(actual, volumetric) per carrier rule.';

create index if not exists eccang_orders_client_idx
  on public.eccang_orders (client_id, created_at desc);
create index if not exists eccang_orders_pending_idx
  on public.eccang_orders (client_id, status)
  where tracking_no is null;

alter table public.eccang_orders enable row level security;

drop policy if exists "tenant_select" on public.eccang_orders;
create policy "tenant_select"
  on public.eccang_orders for select to authenticated
  using (client_id = public.current_client_id());

-- Writes stay service_role only.

alter table public.inbound_cache
  add column if not exists reference_no text,
  add column if not exists eccang_asn_code text,
  add column if not exists product_id uuid references public.products_cache (id) on delete set null,
  add column if not exists items_json jsonb not null default '[]'::jsonb,
  add column if not exists tracking_no text,
  add column if not exists eccang_status text,
  add column if not exists expected_at timestamptz,
  add column if not exists received_at timestamptz,
  add column if not exists putaway_at timestamptz,
  add column if not exists cancelled boolean not null default false,
  add column if not exists last_payload jsonb;

create unique index if not exists inbound_cache_reference_idx
  on public.inbound_cache (client_id, reference_no)
  where reference_no is not null;

-- inbound_cache / stock_cache already carry tenant_select RLS (00002); writes stay service_role.

-- Admin-editable mapping: {"<carrier>|<line>": "<ECCANG shipping method code>", "<carrier>": "..."}
insert into public.pricing_meta (key, value)
values ('eccang_shipping_methods', '{}')
on conflict (key) do nothing;
