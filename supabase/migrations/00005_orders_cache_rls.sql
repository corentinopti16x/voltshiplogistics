-- Voltship Client App — close tenant isolation gap on shopify_orders_cache.
-- Run after 00004_phase1_foundation.sql.

alter table public.shopify_orders_cache enable row level security;

drop policy if exists "tenant_select" on public.shopify_orders_cache;
create policy "tenant_select"
  on public.shopify_orders_cache for select to authenticated
  using (client_id = public.current_client_id());

-- Writes stay service_role only (no insert/update/delete policies for authenticated).
