-- Commandes fournisseurs : quand Voltship passe une commande de production / réassort pour
-- un client, elle est suivie ici et le client la voit avec son avancement.
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  product_id uuid references public.products_cache (id) on delete set null,
  reference text not null,
  title text not null,
  quantity integer not null check (quantity > 0),
  unit_price_eur numeric(12, 4),
  total_eur numeric(12, 2),
  status text not null default 'to_pay'
    check (status in ('to_pay', 'in_production', 'quality_check', 'to_warehouse', 'received', 'cancelled')),
  eta date,
  tracking text,
  notes_client text,
  -- Interne Voltship : jamais lu par les pages client.
  notes_internal text,
  history jsonb not null default '[]'::jsonb,
  paid_at timestamptz,
  received_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reference)
);

create index if not exists purchase_orders_client_idx
  on public.purchase_orders (client_id, status, created_at desc);
create index if not exists purchase_orders_product_idx
  on public.purchase_orders (product_id);

alter table public.purchase_orders enable row level security;

-- Pas de policy : aucune lecture directe avec la clé publique (la colonne notes_internal est
-- confidentielle). Les pages client lisent côté serveur, colonnes filtrées, après contrôle du client.
drop policy if exists "tenant_select" on public.purchase_orders;
