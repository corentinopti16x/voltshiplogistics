-- Commandes à vérifier : alertes partagées Voltship ↔ client (code promo abusé, prix anormal,
-- commande à 0 €, quantité inhabituelle), avec un fil de discussion par alerte.
create table if not exists public.order_alerts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  shopify_order_id text not null,
  order_number text,
  placed_at timestamptz,
  reasons text[] not null default '{}',
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'legit', 'abuse')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (shop_id, shopify_order_id)
);

create index if not exists order_alerts_client_idx
  on public.order_alerts (client_id, status, placed_at desc);

create table if not exists public.order_alert_messages (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.order_alerts (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  author_user_id uuid references auth.users (id) on delete set null,
  author_role text not null check (author_role in ('client', 'voltship', 'system')),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists order_alert_messages_alert_idx
  on public.order_alert_messages (alert_id, created_at);

alter table public.order_alerts enable row level security;
alter table public.order_alert_messages enable row level security;

drop policy if exists "tenant_select" on public.order_alerts;
create policy "tenant_select"
  on public.order_alerts for select to authenticated
  using (client_id = public.current_client_id());

drop policy if exists "tenant_select" on public.order_alert_messages;
create policy "tenant_select"
  on public.order_alert_messages for select to authenticated
  using (client_id = public.current_client_id());
-- Écritures : uniquement côté serveur (service role), après contrôle des droits.
