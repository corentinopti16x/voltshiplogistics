-- Compte démo « Petit Nuage » : garder des ventes récentes sans relancer le script de création.
-- La fonction décale toutes les dates du client démo (code DEMO-PETITNUAGE) pour que la
-- dernière commande soit d'aujourd'hui. Elle ne touche à aucun autre client.
-- Sans danger à relancer : elle ne fait rien si les ventes sont déjà à jour.
create or replace function public.demo_roll_dates()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c uuid;
  delta integer;
begin
  select id into c from clients where code = 'DEMO-PETITNUAGE';
  if c is null then
    return 0;
  end if;
  select current_date - max(order_date) into delta from shopify_orders_cache where client_id = c;
  if delta is null or delta <= 0 then
    return 0;
  end if;

  update shopify_orders_cache
  set order_date = order_date + delta,
      placed_at = placed_at + make_interval(days => delta),
      updated_at = now()
  where client_id = c;

  -- Sales per day rebuilt from the orders, as the seed does.
  delete from sales_cache where client_id = c;
  insert into sales_cache (client_id, shop_id, sku, date, units_sold)
  select o.client_id, o.shop_id, line ->> 'sku', o.order_date, sum((line ->> 'quantity')::int)
  from shopify_orders_cache o
  cross join lateral jsonb_array_elements(o.line_items_json) line
  where o.client_id = c and not o.cancelled and line ? 'sku'
  group by o.client_id, o.shop_id, line ->> 'sku', o.order_date;

  update products_cache set created_date = created_date + delta
  where client_id = c and created_date is not null;
  update stock_cache set last_synced_at = now() where client_id = c;
  update shops set last_synced_at = now() where client_id = c;
  update notifications
  set created_at = created_at + make_interval(days => delta),
      read_at = read_at + make_interval(days => delta)
  where client_id = c;

  return delta;
end;
$$;

revoke all on function public.demo_roll_dates() from public, anon, authenticated;
