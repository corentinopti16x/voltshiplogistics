-- Voltship Client App — line routing (14 Oct. 2026). Run in the Supabase SQL editor AFTER 00022. Safe to re-run.
--
-- Voltship decides the carrier line of every parcel (cheapest line covering the postcode),
-- not the carrier nor the warehouse software. On 14 Oct. 452 parcels left on YunExpress 特惠
-- instead of 商派 (≈ 2 040 RMB more) without anyone seeing it.
--
-- * carrier_zip_coverage: postcode list of a line per market. mode "only" = the line ships
--   only these codes (Huahan 内电 USA), "except" = every code but these. Entries shorter
--   than a full code are prefixes ("945" = 945xx). A line without a list is trusted for the
--   market's automatic carriers (pricing_settings.auto_carriers) and skipped for the others.
-- * eccang_order_line_checks: per ECCANG order, the line the app planned and the line the
--   parcel is on in ECCANG, with their carrier cost in RMB. INTERNAL (Voltship costs): its
--   own table, service role only — eccang_orders is readable by the client. Read-only on
--   ECCANG: a dearer parcel still without label is shown so the team switches it in time.

create table if not exists public.carrier_zip_coverage (
  id uuid primary key default gen_random_uuid(),
  destination text not null,
  carrier text not null,
  line_name text not null default '',
  mode text not null default 'only',
  zips text[] not null default '{}',
  note text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint carrier_zip_coverage_mode_check check (mode in ('only', 'except')),
  constraint carrier_zip_coverage_line_key unique (destination, carrier, line_name)
);

comment on table public.carrier_zip_coverage is
  'Postcodes a carrier line ships per market (only) or does not ship (except). Prefixes allowed. Admin only (service role).';

alter table public.carrier_zip_coverage enable row level security;

create table if not exists public.eccang_order_line_checks (
  order_id uuid primary key references public.eccang_orders (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  reference_no text not null,
  destination text,
  zip text,
  weight_g integer,
  shipping_method text,
  order_status text,
  has_tracking boolean not null default false,
  planned_line text,
  planned_cost_rmb numeric,
  actual_line text,
  actual_cost_rmb numeric,
  extra_rmb numeric,
  status text not null,
  -- Hash of what the check used (order data, grid, postcode lists, method map): unchanged = skipped.
  fingerprint text,
  checked_at timestamptz not null default now(),
  constraint eccang_order_line_checks_status_check
    check (status in ('ok', 'more_expensive', 'cheaper', 'unknown_line', 'no_plan', 'no_data'))
);

comment on table public.eccang_order_line_checks is
  'INTERNAL: planned vs actual carrier line of each ECCANG order (costs in RMB). Service role only.';

alter table public.eccang_order_line_checks enable row level security;

create index if not exists eccang_order_line_checks_status_idx
  on public.eccang_order_line_checks (status, checked_at desc);
create index if not exists eccang_order_line_checks_client_idx
  on public.eccang_order_line_checks (client_id, checked_at desc);
