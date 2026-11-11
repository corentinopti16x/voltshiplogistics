-- Transport configuration by line and country (page « Transport »).
-- One row per (destination, carrier, line): whether the line is open at Voltship, the ECCANG
-- shipping method it ships on for that country, its delivery time and a free note.
-- A line without a row is « active » (current behaviour). A « pending » line is never
-- picked by the COGS engine nor by the line routing.
-- Safe to re-run. Creates one new table, touches no existing one.

create table if not exists public.carrier_line_settings (
  id uuid primary key default gen_random_uuid(),
  destination text not null,
  carrier text not null,
  line_name text not null default '',
  status text not null default 'active' check (status in ('active', 'pending')),
  eccang_method text,
  delivery_days text,
  note text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (destination, carrier, line_name)
);

alter table public.carrier_line_settings enable row level security;
-- No policy: the app reads and writes this table through the service role only.
