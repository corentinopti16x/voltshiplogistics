-- Voltship Client App — Phase 1 integration foundation
-- Run after 00003_impersonation_nullable.sql.

alter table public.rate_grid_cells
  add column if not exists delivery_range text;

alter table public.shops
  add column if not exists shopify_shop_id text,
  add column if not exists scopes text,
  add column if not exists last_synced_at timestamptz,
  add column if not exists sync_error text;

create table if not exists public.shopify_products_cache (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  shopify_product_id text not null,
  shopify_variant_id text not null,
  title text not null,
  sku text,
  photo_url text,
  status text,
  units_90d integer not null default 0,
  imported_product_id uuid references public.products_cache (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (shop_id, shopify_variant_id)
);

create index if not exists shopify_products_client_idx
  on public.shopify_products_cache (client_id, shop_id, units_90d desc);

create table if not exists public.shopify_orders_cache (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  shopify_order_id text not null,
  order_date date not null,
  cancelled boolean not null default false,
  line_items_json jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (shop_id, shopify_order_id)
);

create index if not exists shopify_orders_client_idx
  on public.shopify_orders_cache (client_id, shop_id, order_date desc);

alter table public.shopify_products_cache enable row level security;

drop policy if exists "tenant_select" on public.shopify_products_cache;
create policy "tenant_select"
  on public.shopify_products_cache for select to authenticated
  using (client_id = public.current_client_id());

create or replace function public.increment_sales_cache(
  p_client_id uuid,
  p_shop_id uuid,
  p_sku text,
  p_date date,
  p_units integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sales_cache (client_id, shop_id, sku, date, units_sold)
  values (p_client_id, p_shop_id, p_sku, p_date, p_units)
  on conflict (client_id, shop_id, sku, date)
  do update set units_sold = greatest(
    0,
    public.sales_cache.units_sold + excluded.units_sold
  );
end;
$$;

revoke all on function public.increment_sales_cache(uuid, uuid, text, date, integer)
  from public, anon, authenticated;
grant execute on function public.increment_sales_cache(uuid, uuid, text, date, integer)
  to service_role;

create table if not exists public.sourcing_work (
  product_id uuid primary key references public.products_cache (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  factory_purchase_price numeric(12, 4),
  supplier_name text,
  supplier_contact text,
  sourcing_location text,
  sample_urls_json jsonb not null default '[]'::jsonb,
  internal_notes text,
  flagged_reason text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists sourcing_work_client_id_idx
  on public.sourcing_work (client_id, updated_at);

alter table public.sourcing_work enable row level security;

drop policy if exists "sourcer_admin_select" on public.sourcing_work;
create policy "sourcer_admin_select"
  on public.sourcing_work for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('sourcer'::public.user_role, 'voltship_admin'::public.user_role)
    )
  );

-- Sourcer writes and all integration writes go through server-only service-role
-- actions so internal supplier fields never enter a tenant RLS response.

insert into storage.buckets (id, name, public)
values ('product-uploads', 'product-uploads', false)
on conflict (id) do update set public = false;
