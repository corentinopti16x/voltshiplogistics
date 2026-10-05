-- Voltship Client App — Finances (admin-only weekly profitability)
-- Run in the Supabase SQL editor AFTER 00009. Safe to re-run.
--
-- * fixed_costs: recurring or one-off Voltship costs (rent, salaries, tools…), prorated
--   per ISO week by the app (monthly × 12/52, weekly as-is, one_off in its week).
-- * finance_adjustments: manual signed one-offs attached to a week (a refund, a bonus
--   billed to a client, a damaged parcel…), kind = revenue | cost.
-- * finance_weekly_snapshot: cache of the computed weeks (payload = FinanceWeek JSON).
--
-- All three tables are CONFIDENTIAL: readable by voltship_admin only through RLS, and
-- written exclusively through the service role (server actions / loaders that call
-- assertVoltshipAdmin()). Nothing here is ever exposed to a client session.

create table if not exists public.fixed_costs (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  amount_eur numeric(12, 2) not null check (amount_eur >= 0),
  period text not null default 'monthly' check (period in ('monthly', 'weekly', 'one_off')),
  start_date date not null default current_date,
  end_date date check (end_date is null or end_date >= start_date),
  category text not null default 'autre'
    check (category in ('loyer', 'salaires', 'outils', 'logistique', 'marketing', 'autre')),
  notes text,
  created_at timestamptz not null default now()
);

comment on table public.fixed_costs is
  'Voltship fixed costs (EUR). monthly → ×12/52 per week; weekly → as-is; one_off → counted in the ISO week of start_date.';

create index if not exists fixed_costs_period_idx on public.fixed_costs (start_date, end_date);

create table if not exists public.finance_adjustments (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  label text not null,
  amount_eur numeric(12, 2) not null,
  kind text not null check (kind in ('revenue', 'cost')),
  notes text,
  created_at timestamptz not null default now()
);

comment on column public.finance_adjustments.week_start is
  'Monday (Europe/Paris) of the ISO week the adjustment belongs to.';
comment on column public.finance_adjustments.amount_eur is
  'Signed EUR amount. revenue: added to the week revenue; cost: added to the week variable costs. A negative cost is a credit.';

create index if not exists finance_adjustments_week_idx on public.finance_adjustments (week_start);

create table if not exists public.finance_weekly_snapshot (
  week_start date primary key,
  computed_at timestamptz not null default now(),
  payload jsonb not null
);

comment on table public.finance_weekly_snapshot is
  'Cache of computed FinanceWeek payloads. Current + previous week are recomputed on every view; older weeks are reused unless ?recompute=1.';

alter table public.fixed_costs enable row level security;
alter table public.finance_adjustments enable row level security;
alter table public.finance_weekly_snapshot enable row level security;

drop policy if exists "admin_select" on public.fixed_costs;
create policy "admin_select" on public.fixed_costs for select to authenticated
  using (public.current_role() = 'voltship_admin');

drop policy if exists "admin_select" on public.finance_adjustments;
create policy "admin_select" on public.finance_adjustments for select to authenticated
  using (public.current_role() = 'voltship_admin');

drop policy if exists "admin_select" on public.finance_weekly_snapshot;
create policy "admin_select" on public.finance_weekly_snapshot for select to authenticated
  using (public.current_role() = 'voltship_admin');

-- Writes stay service_role only (no insert/update/delete policies).
