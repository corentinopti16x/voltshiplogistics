-- Voltship Client App — remaining Phase 1 tables
-- Run in the Supabase SQL editor AFTER 00001_init.sql (clients + profiles).
-- Safe to re-run (IF NOT EXISTS / drop policy if exists).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.shop_status as enum ('pending', 'active', 'disconnected');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.lifecycle_status as enum (
    'testing', 'winning', 'declining', 'dead', 'archived'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.sourcing_status as enum (
    'brief_received',
    'factories',
    'samples',
    'negotiation',
    'quote_sent',
    'validated',
    'in_production',
    'in_stock',
    'flagged'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.shipping_channel as enum (
    'standard',
    'electronics_battery',
    'cosmetics',
    'liquid_perfume',
    'magnetic',
    'sensitive_other'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.migration_state as enum (
    'imported_pending',
    'ignored',
    'active'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.inbound_status as enum (
    'announced',
    'arrived',
    'qc_in_progress',
    'stocked',
    'quarantined'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.webhook_status as enum ('received', 'processed', 'dead');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Extend clients (settings + pricing inputs)
-- ---------------------------------------------------------------------------

alter table public.clients
  add column if not exists eccang_customer_code text,
  add column if not exists airtable_client_record_id text,
  add column if not exists financial_profile_json jsonb not null default '{
    "psp_pct": 0,
    "urssaf_pct": 0,
    "vat_pct": 0,
    "other_pct": 0,
    "min_margin_pct": 15,
    "target_margin_pct": 20
  }'::jsonb,
  add column if not exists commission_pct numeric(6, 3),
  add column if not exists handling_fee numeric(12, 4),
  add column if not exists logistics_discount_pct numeric(6, 3),
  add column if not exists safety_buffer_days integer not null default 7,
  add column if not exists coverage_target_days integer not null default 60,
  add column if not exists lifecycle_thresholds_json jsonb not null default '{
    "testing_max_age_days": 60,
    "winning_min_orders_per_day_14d": 5,
    "declining_sales_drop_pct": 50,
    "dead_no_sales_days": 90
  }'::jsonb;

-- ---------------------------------------------------------------------------
-- Shops (max 10 per client — trigger below)
-- ---------------------------------------------------------------------------

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  shopify_domain text not null,
  access_token_encrypted text,
  status public.shop_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (client_id, shopify_domain)
);

create or replace function public.enforce_max_shops()
returns trigger
language plpgsql
as $$
begin
  if (
    select count(*) from public.shops
    where client_id = new.client_id
      and (tg_op = 'INSERT' or id <> new.id)
  ) >= 10 then
    raise exception 'A client can have at most 10 Shopify shops';
  end if;
  return new;
end;
$$;

drop trigger if exists shops_max_10 on public.shops;
create trigger shops_max_10
  before insert or update of client_id on public.shops
  for each row execute function public.enforce_max_shops();

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  type text not null,
  payload_json jsonb not null default '{}'::jsonb,
  channels text[] not null default array['in_app']::text[],
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_type text not null,
  in_app boolean not null default true,
  email boolean not null default true,
  whatsapp boolean not null default true,
  unique (user_id, event_type)
);

-- ---------------------------------------------------------------------------
-- Audit + webhooks + impersonation
-- ---------------------------------------------------------------------------

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles (id) on delete set null,
  impersonated_user_id uuid references public.profiles (id) on delete set null,
  client_id uuid references public.clients (id) on delete set null,
  action text not null,
  entity text,
  diff_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  type text not null,
  external_id text,
  payload_json jsonb not null default '{}'::jsonb,
  status public.webhook_status not null default 'received',
  attempts integer not null default 0,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);

create table if not exists public.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles (id) on delete cascade,
  target_user_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Product cache (CLIENT-SAFE columns only — never factory price / supplier)
-- ---------------------------------------------------------------------------

create table if not exists public.products_cache (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  airtable_record_id text not null,
  sku text,
  title text not null,
  photo_url text,
  created_date date,
  lifecycle_status public.lifecycle_status,
  sourcing_status public.sourcing_status,
  quote_json jsonb,
  accepted_quote_snapshot_json jsonb,
  selling_price numeric(12, 4),
  weight_g integer,
  shipping_channel public.shipping_channel,
  production_lead_days integer,
  moq integer,
  client_price numeric(12, 4),
  stock_manual integer,
  migration_state public.migration_state,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (airtable_record_id)
);

comment on table public.products_cache is
  'Client-visible product projection. Factory price, supplier name/contact, sourcing margin live in Airtable only.';

create table if not exists public.sales_cache (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  sku text not null,
  date date not null,
  units_sold integer not null default 0,
  unique (client_id, shop_id, sku, date)
);

create table if not exists public.stock_cache (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  sku text not null,
  qty_available integer not null default 0,
  qty_reserved integer not null default 0,
  inbound_qty integer not null default 0,
  reorder_threshold integer,
  out_of_stock_since date,
  last_synced_at timestamptz,
  unique (client_id, sku)
);

create table if not exists public.inbound_cache (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  eccang_ref text,
  status public.inbound_status not null default 'announced',
  qty_announced integer,
  qty_received integer,
  photos_json jsonb not null default '[]'::jsonb,
  qc_defect_rate numeric(6, 3),
  eta date,
  updated_at timestamptz not null default now()
);

create table if not exists public.sku_maps (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  shopify_sku text,
  eccang_sku text,
  airtable_record_id text,
  unique (client_id, shop_id, shopify_sku)
);

create table if not exists public.generation_usage (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  deliverable_type text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Pricing (mirror of ECCANG / Airtable grid — never invoice source)
-- ---------------------------------------------------------------------------

create table if not exists public.rate_grids (
  id uuid primary key default gen_random_uuid(),
  grid_version text not null unique,
  effective_date date not null default current_date,
  source text not null default 'airtable',
  created_at timestamptz not null default now()
);

create table if not exists public.rate_grid_cells (
  id uuid primary key default gen_random_uuid(),
  grid_version text not null references public.rate_grids (grid_version) on delete cascade,
  carrier text not null,
  destination text not null,
  channel public.shipping_channel not null default 'standard',
  weight_min_g integer not null,
  weight_max_g integer not null,
  price numeric(12, 4) not null,
  unique (grid_version, carrier, destination, channel, weight_min_g, weight_max_g)
);

create table if not exists public.pricing_meta (
  key text primary key,
  value text not null
);

insert into public.pricing_meta (key, value)
values ('active_grid_version', 'uninitialized')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists shops_client_id_idx on public.shops (client_id);
create index if not exists notifications_client_id_idx on public.notifications (client_id, created_at desc);
create index if not exists products_cache_client_id_idx on public.products_cache (client_id, created_date desc);
create index if not exists products_cache_lifecycle_idx on public.products_cache (client_id, lifecycle_status);
create index if not exists sales_cache_sku_date_idx on public.sales_cache (client_id, sku, date);
create index if not exists inbound_cache_client_id_idx on public.inbound_cache (client_id, updated_at desc);
create index if not exists webhook_events_status_idx on public.webhook_events (status, created_at);
create index if not exists audit_log_client_id_idx on public.audit_log (client_id, created_at desc);
create index if not exists generation_usage_client_created_idx
  on public.generation_usage (client_id, created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Reads: tenant isolation. Writes: service role (server), except a few client updates.
-- Rate grid is admin/sourcer only — never shipped to the client browser.
-- ---------------------------------------------------------------------------

alter table public.shops enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.audit_log enable row level security;
alter table public.webhook_events enable row level security;
alter table public.impersonation_sessions enable row level security;
alter table public.products_cache enable row level security;
alter table public.sales_cache enable row level security;
alter table public.stock_cache enable row level security;
alter table public.inbound_cache enable row level security;
alter table public.sku_maps enable row level security;
alter table public.generation_usage enable row level security;
alter table public.rate_grids enable row level security;
alter table public.rate_grid_cells enable row level security;
alter table public.pricing_meta enable row level security;

-- Tenant read helper: own client OR cross-tenant staff
-- shops: hide nothing at RLS row level; never select access_token_encrypted in client queries

drop policy if exists "tenant_select" on public.shops;
create policy "tenant_select" on public.shops for select to authenticated
  using (
    client_id = public.current_client_id()
    or public.current_role() in ('sourcer', 'voltship_admin')
  );

drop policy if exists "tenant_select" on public.products_cache;
create policy "tenant_select" on public.products_cache for select to authenticated
  using (
    client_id = public.current_client_id()
    or public.current_role() in ('sourcer', 'voltship_admin')
  );

drop policy if exists "tenant_select" on public.sales_cache;
create policy "tenant_select" on public.sales_cache for select to authenticated
  using (
    client_id = public.current_client_id()
    or public.current_role() in ('sourcer', 'voltship_admin')
  );

drop policy if exists "tenant_select" on public.stock_cache;
create policy "tenant_select" on public.stock_cache for select to authenticated
  using (
    client_id = public.current_client_id()
    or public.current_role() in ('sourcer', 'voltship_admin')
  );

drop policy if exists "tenant_select" on public.inbound_cache;
create policy "tenant_select" on public.inbound_cache for select to authenticated
  using (
    client_id = public.current_client_id()
    or public.current_role() in ('sourcer', 'voltship_admin')
  );

drop policy if exists "tenant_select" on public.sku_maps;
create policy "tenant_select" on public.sku_maps for select to authenticated
  using (
    client_id = public.current_client_id()
    or public.current_role() in ('sourcer', 'voltship_admin')
  );

drop policy if exists "tenant_select" on public.generation_usage;
create policy "tenant_select" on public.generation_usage for select to authenticated
  using (
    client_id = public.current_client_id()
    or public.current_role() in ('sourcer', 'voltship_admin')
  );

drop policy if exists "tenant_select" on public.notifications;
create policy "tenant_select" on public.notifications for select to authenticated
  using (
    client_id = public.current_client_id()
    or public.current_role() in ('sourcer', 'voltship_admin')
  );

drop policy if exists "mark_read" on public.notifications;
create policy "mark_read" on public.notifications for update to authenticated
  using (user_id = auth.uid() or public.current_role() in ('voltship_admin'))
  with check (user_id = auth.uid() or public.current_role() in ('voltship_admin'));

drop policy if exists "tenant_select" on public.notification_preferences;
create policy "tenant_select" on public.notification_preferences for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_role() in ('sourcer', 'voltship_admin')
  );

drop policy if exists "own_upsert" on public.notification_preferences;
create policy "own_upsert" on public.notification_preferences for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "own_update" on public.notification_preferences;
create policy "own_update" on public.notification_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Admin-only reads
drop policy if exists "staff_select" on public.audit_log;
create policy "staff_select" on public.audit_log for select to authenticated
  using (public.current_role() in ('sourcer', 'voltship_admin'));

drop policy if exists "admin_select" on public.impersonation_sessions;
create policy "admin_select" on public.impersonation_sessions for select to authenticated
  using (public.current_role() = 'voltship_admin');

drop policy if exists "staff_select" on public.rate_grids;
create policy "staff_select" on public.rate_grids for select to authenticated
  using (public.current_role() in ('sourcer', 'voltship_admin'));

drop policy if exists "staff_select" on public.rate_grid_cells;
create policy "staff_select" on public.rate_grid_cells for select to authenticated
  using (public.current_role() in ('sourcer', 'voltship_admin'));

drop policy if exists "staff_select" on public.pricing_meta;
create policy "staff_select" on public.pricing_meta for select to authenticated
  using (public.current_role() in ('sourcer', 'voltship_admin'));

-- webhook_events: no authenticated policies → only service_role can read/write
-- products_cache writes: service_role only (no insert/update policies for authenticated)
