-- Voltship — compte DÉMO « Petit Nuage » (niche enfant). Données 100 % fictives.
-- À lancer dans le SQL Editor de Supabase. Relançable : il efface puis recrée UNIQUEMENT
-- les données du client démo (code DEMO-PETITNUAGE), dates recalculées par rapport à aujourd'hui.
-- Ensuite : Admin → client « Petit Nuage (démo) » → inviter l'e-mail de démo.

do $$
declare
  c uuid;
  s uuid;
  p record;
  d int;
  n int;
  i int;
  qty int;
  at timestamptz;
  rate numeric;
  total numeric;
  seq int := 1000;
begin
  select id into c from public.clients where code = 'DEMO-PETITNUAGE';
  if c is null then
    insert into public.clients (name, code, language, plan_tier)
    values ('Petit Nuage (démo)', 'DEMO-PETITNUAGE', 'fr', 'gold')
    returning id into c;
  end if;

  -- Reset demo data only.
  delete from public.notifications where client_id = c;
  delete from public.shopify_orders_cache where client_id = c;
  delete from public.sales_cache where client_id = c;
  delete from public.stock_cache where client_id = c;
  delete from public.sku_maps where client_id = c;
  delete from public.products_cache where client_id = c;

  -- Fake store: active but without token, so the Shopify sync never touches it.
  select id into s from public.shops where client_id = c;
  if s is null then
    insert into public.shops (client_id, shopify_domain, status, last_synced_at)
    values (c, 'petit-nuage-demo.myshopify.com', 'active', now())
    returning id into s;
  else
    update public.shops set status = 'active', access_token_encrypted = null, last_synced_at = now() where id = s;
  end if;

  create temporary table demo_live (
    k text, title text, photo text, price numeric, cost numeric, weight int,
    rate numeric, trend text, stock int, age int, sourcing text, migration text
  ) on commit drop;
  insert into demo_live values
    ('VEILLEUSE','Veilleuse projecteur étoiles','data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="%231E2A5A"/><circle cx="200" cy="150" r="95" fill="%23ffffff" fill-opacity="0.45"/><text x="200" y="185" font-size="110" text-anchor="middle">%F0%9F%8C%99</text></svg>',34.9,6.2,380,9,'up',420,120,'validated','imported_pending'),
    ('TAPIS','Tapis d''éveil Montessori','data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23F6D7C3"/><circle cx="200" cy="150" r="95" fill="%23ffffff" fill-opacity="0.45"/><text x="200" y="185" font-size="110" text-anchor="middle">%F0%9F%A7%B8</text></svg>',49.9,11.5,900,5,'flat',160,150,'validated','imported_pending'),
    ('GOURDE','Gourde isotherme licorne','data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23E8D9F7"/><circle cx="200" cy="150" r="95" fill="%23ffffff" fill-opacity="0.45"/><text x="200" y="185" font-size="110" text-anchor="middle">%F0%9F%A6%84</text></svg>',24.9,3.8,260,4,'flat',95,140,'validated','imported_pending'),
    ('NUAGE','Lampe de chevet nuage','data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23D6E9F8"/><circle cx="200" cy="150" r="95" fill="%23ffffff" fill-opacity="0.45"/><text x="200" y="185" font-size="110" text-anchor="middle">%E2%98%81%EF%B8%8F</text></svg>',39.9,7.4,520,6,'drop',28,130,'validated','imported_pending'),
    ('SAC','Sac à dos maternelle','data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23FFE3A3"/><circle cx="200" cy="150" r="95" fill="%23ffffff" fill-opacity="0.45"/><text x="200" y="185" font-size="110" text-anchor="middle">%F0%9F%8E%92</text></svg>',29.9,5.1,420,3,'slow',210,160,'validated','imported_pending'),
    ('LIVRE','Livre sensoriel bébé','data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23D9F2E3"/><circle cx="200" cy="150" r="95" fill="%23ffffff" fill-opacity="0.45"/><text x="200" y="185" font-size="110" text-anchor="middle">%F0%9F%93%9A</text></svg>',19.9,2.6,240,0.06,'flat',140,100,'validated','imported_pending'),
    ('PUZZLE','Puzzle bois animaux','data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23FBD3D9"/><circle cx="200" cy="150" r="95" fill="%23ffffff" fill-opacity="0.45"/><text x="200" y="185" font-size="110" text-anchor="middle">%F0%9F%A7%A9</text></svg>',22.9,3.2,350,0.1,'new',80,12,'validated','imported_pending');

  create temporary table demo_new (
    k text, title text, photo text, status text, price numeric, cost numeric, weight int, descr text
  ) on commit drop;
  insert into demo_new values
    ('TROTTINETTE','Trottinette 3 roues lumineuse','data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23CDEFF5"/><circle cx="200" cy="150" r="95" fill="%23ffffff" fill-opacity="0.45"/><text x="200" y="185" font-size="110" text-anchor="middle">%F0%9F%9B%B4</text></svg>','brief_received',null,null,null,'Trottinette 3 roues pliable avec roues LED, 2-5 ans, guidon réglable.'),
    ('DOUDOU','Doudou bruit blanc mouton','data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23F2EEE6"/><circle cx="200" cy="150" r="95" fill="%23ffffff" fill-opacity="0.45"/><text x="200" y="185" font-size="110" text-anchor="middle">%F0%9F%90%91</text></svg>','samples',null,null,null,'Peluche mouton avec bruit blanc et berceuses, minuterie 30 min, rechargeable USB-C.'),
    ('TIPI','Tente tipi enfant','data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23F7E1C8"/><circle cx="200" cy="150" r="95" fill="%23ffffff" fill-opacity="0.45"/><text x="200" y="185" font-size="110" text-anchor="middle">%E2%9B%BA</text></svg>','quote_sent','59.9','14.8','2100','Tipi en coton 4 pans, 160 cm, tapis de sol et guirlande inclus.');

  -- Live catalogue (migrated from the store)
  insert into public.products_cache (
    client_id, airtable_record_id, sku, title, photo_url, created_date, lifecycle_status,
    sourcing_status, quote_json, selling_price, weight_g, shipping_channel, client_price,
    migration_state, production_lead_days, moq
  )
  select c, 'pending:demo-' || lower(k), 'PN-' || k, title, photo, (current_date - age),
    'testing', sourcing::public.sourcing_status,
    jsonb_build_object('_request', jsonb_build_object('destination_markets', 'FR'), '_sync', jsonb_build_object('status', 'synced')),
    price, weight, 'standard', cost, migration::public.migration_state, 12, 200
  from demo_live;

  -- New products in the sourcing pipeline
  insert into public.products_cache (
    client_id, airtable_record_id, sku, title, photo_url, created_date, lifecycle_status,
    sourcing_status, quote_json, selling_price, weight_g, shipping_channel, client_price, moq,
    production_lead_days
  )
  select c, 'pending:demo-' || lower(k), null, title, photo, current_date - 6, 'testing',
    status::public.sourcing_status,
    jsonb_build_object('_request', jsonb_build_object(
      'description', descr, 'destination_markets', 'FR', 'expected_launch_qty', 300,
      'target_unit_price', price)),
    price, weight, case when weight is null then null else 'standard'::public.shipping_channel end,
    cost, case when status = 'quote_sent' then 300 else null end,
    case when status = 'quote_sent' then 15 else null end
  from demo_new;

  -- 90 days of orders (rolling from now), 1-3 units, some repeat customers
  for p in select * from demo_live loop
    for d in 0..89 loop
      exit when d > p.age;
      rate := case p.trend
        when 'up'   then p.rate * (0.45 + (89 - d) / 89.0 * 0.9)
        when 'drop' then case when d < 14 then p.rate * 0.3 else p.rate end
        when 'slow' then p.rate * (0.6 + d / 89.0 * 0.8)
        else p.rate end;
      n := floor(rate + random())::int;
      for i in 1..n loop
        qty := case when random() < 0.68 then 1 when random() < 0.75 then 2 else 3 end;
        at := now() - make_interval(days => d) - make_interval(secs => floor(random() * 86400)::int);
        total := round(qty * p.price + case when qty = 1 then 4.90 else 0 end, 2);
        seq := seq + 1;
        insert into public.shopify_orders_cache (
          client_id, shop_id, shopify_order_id, order_number, order_date, placed_at, cancelled,
          customer_key, line_items_json
        ) values (
          c, s, 'demo-' || seq, seq::text, at::date, at, random() < 0.02,
          md5('demo-customer-' || floor(random() * 6000)::text),
          jsonb_build_array(
            jsonb_build_object('_order', jsonb_build_object(
              'fulfilled', d >= 2 or random() < 0.3, 'total', total, 'currency', 'EUR', 'units', qty)),
            jsonb_build_object('sku', 'PN-' || p.k, 'quantity', qty, 'title', p.title, 'price', p.price)
          )
        );
      end loop;
    end loop;
  end loop;

  -- Daily sales (what the lifecycle rule and stock days read)
  insert into public.sales_cache (client_id, shop_id, sku, date, units_sold)
  select c, s, line ->> 'sku', o.order_date, sum((line ->> 'quantity')::int)
  from public.shopify_orders_cache o
  cross join lateral jsonb_array_elements(o.line_items_json) line
  where o.client_id = c and not o.cancelled and line ? 'sku'
  group by line ->> 'sku', o.order_date;

  insert into public.sku_maps (client_id, shop_id, shopify_sku, airtable_record_id)
  select c, s, 'PN-' || k, 'pending:demo-' || lower(k) from demo_live;

  -- Warehouse stock (the cloud lamp is close to running out)
  insert into public.stock_cache (client_id, sku, qty_available, inbound_qty, last_synced_at)
  select c, 'PN-' || k, stock, case when k = 'NUAGE' then 300 else 0 end, now() from demo_live;

  -- Lifecycle with Voltship's rule (5 sales over 14 days = winning)
  update public.products_cache pc set lifecycle_status = x.status::public.lifecycle_status
  from (
    select l.k,
      case
        when coalesce(prev14, 0) >= 5 and coalesce(last14, 0) <= prev14 * 0.5 then 'declining'
        when coalesce(last14, 0) >= 5 then 'winning'
        else 'testing' end as status
    from demo_live l
    left join (
      select sku,
        sum(units_sold) filter (where date > current_date - 14) as last14,
        sum(units_sold) filter (where date <= current_date - 14 and date > current_date - 28) as prev14
      from public.sales_cache where client_id = c group by sku
    ) agg on agg.sku = 'PN-' || l.k
  ) x
  where pc.client_id = c and pc.sku = 'PN-' || x.k;

  -- A few notifications
  insert into public.notifications (client_id, type, payload_json, channels, created_at)
  select c, 'quote_ready',
    jsonb_build_object('productId', id, 'productTitle', title,
      'message', 'Ton devis pour « ' || title || ' » est prêt : coût de revient livré et délai à valider.'),
    array['in_app'], now() - interval '3 hours'
  from public.products_cache where client_id = c and sourcing_status = 'quote_sent';

  insert into public.notifications (client_id, type, payload_json, channels, created_at)
  select c, 'lifecycle_changed',
    jsonb_build_object('productId', id, 'productTitle', title, 'from', 'testing', 'to', 'winning',
      'message', title || ' est maintenant Winning 🔥'),
    array['in_app'], now() - interval '1 day'
  from public.products_cache where client_id = c and sku = 'PN-VEILLEUSE';

  insert into public.notifications (client_id, type, payload_json, channels, created_at, read_at)
  select c, 'lifecycle_changed',
    jsonb_build_object('productId', id, 'productTitle', title, 'from', 'winning', 'to', 'declining',
      'message', title || ' ralentit : ventes divisées par deux sur 14 jours.'),
    array['in_app'], now() - interval '2 days', now() - interval '1 day'
  from public.products_cache where client_id = c and sku = 'PN-NUAGE';
end $$;
