-- Voltship Client App — AI-assisted rate grid updates ("Mettre à jour les tarifs")
-- Run in the Supabase SQL editor AFTER 00006. Safe to re-run.
--
-- * rate_grid_cells gains the carrier line, the raw carrier cost (RMB), a tax flag
--   and free-text notes so quotes can show "carrier · line · tier · delivery".
-- * rate_grids keeps the margin / FX snapshot used to build the grid.
-- * rate_grid_imports stores one assistant run (raw input → model output → proposed
--   cells → comparison) until the admin activates or discards it.
-- * pricing_meta.pricing_settings holds the editable margin rule (JSON).

alter table public.rate_grid_cells
  add column if not exists line_name text,
  add column if not exists tax_included boolean not null default true,
  add column if not exists notes text,
  add column if not exists carrier_cost_rmb numeric(12, 4);

comment on column public.rate_grid_cells.line_name is
  'Carrier service line (e.g. "YunExpress CHC", "4PX O5"). Shown on client quotes.';
comment on column public.rate_grid_cells.tax_included is
  'false = the carrier line is not tax-inclusive; the EU per-parcel tax was added to price.';
comment on column public.rate_grid_cells.carrier_cost_rmb is
  'Raw carrier cost for this bracket in RMB, before FX, margin and tax. Internal only.';

alter table public.rate_grids
  add column if not exists notes text,
  add column if not exists source_files jsonb not null default '[]'::jsonb,
  add column if not exists settings_json jsonb;

comment on column public.rate_grids.settings_json is
  'Snapshot of pricing_settings (fx_rmb_per_eur, margin_pct, min_margin_eur_per_parcel, eu_parcel_tax_eur) used to build this grid.';

do $$ begin
  create type public.rate_import_status as enum ('draft', 'reviewed', 'activated', 'discarded');
exception when duplicate_object then null;
end $$;

create table if not exists public.rate_grid_imports (
  id uuid primary key default gen_random_uuid(),
  status public.rate_import_status not null default 'draft',
  carrier text,
  destination_hint text,
  raw_text text,
  model_output_json jsonb,
  proposed_cells_json jsonb,
  summary_json jsonb,
  grid_version text references public.rate_grids (grid_version) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rate_grid_imports_created_idx
  on public.rate_grid_imports (created_at desc);

alter table public.rate_grid_imports enable row level security;

drop policy if exists "staff_select" on public.rate_grid_imports;
create policy "staff_select" on public.rate_grid_imports for select to authenticated
  using (public.current_role() in ('sourcer', 'voltship_admin'));

-- Writes: service_role only (server actions).

insert into public.pricing_meta (key, value)
values (
  'pricing_settings',
  '{"fx_rmb_per_eur":7.5,"margin_pct":12,"min_margin_eur_per_parcel":1.5,"eu_parcel_tax_eur":3}'
)
on conflict (key) do nothing;
