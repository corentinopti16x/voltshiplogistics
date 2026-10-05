-- Voltship Client App — "TOUT COMPRIS" matrix import: IOSS flag + several lines per carrier
-- Run in the Supabase SQL editor AFTER 00008. Safe to re-run.
--
-- * rate_grid_cells.ioss_required — informational: the line ships under the client's
--   IOSS number (YunExpress CHC, 4PX EU S5667/S5664/S5682, "IOSS obligatoire"). Never a cost.
-- * line_name joins the unique key so one carrier can carry two lines on the same
--   destination / channel / bracket (USA YunExpress THPHR vs 商派 YTSPTHPH); the engine
--   (findRateCell) picks the cheapest cell. line_name becomes '' instead of null so the
--   unique constraint (and PostgREST upserts) treat missing names as equal.

alter table public.rate_grid_cells
  add column if not exists ioss_required boolean not null default false;

comment on column public.rate_grid_cells.ioss_required is
  'The line ships under the client IOSS number (informational badge "IOSS requis"). Not a cost.';

update public.rate_grid_cells set line_name = '' where line_name is null;

alter table public.rate_grid_cells
  alter column line_name set default '',
  alter column line_name set not null;

alter table public.rate_grid_cells
  drop constraint if exists rate_grid_cells_grid_version_carrier_destination_channel_wei_key;

alter table public.rate_grid_cells
  drop constraint if exists rate_grid_cells_line_key;

alter table public.rate_grid_cells
  add constraint rate_grid_cells_line_key
  unique (grid_version, carrier, destination, channel, weight_min_g, weight_max_g, line_name);

-- Grid prices are all-inclusive: the per-parcel supplement is a manual knob, normally 0.
update public.pricing_meta
set value = jsonb_set(value::jsonb, '{eu_parcel_tax_eur}', '0'::jsonb)::text
where key = 'pricing_settings'
  and (value::jsonb ->> 'eu_parcel_tax_eur') = '3';
