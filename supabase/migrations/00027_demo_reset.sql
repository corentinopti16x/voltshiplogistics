-- Compte démo « Petit Nuage » (code DEMO-PETITNUAGE) : données 100 % fictives pour montrer
-- l'application à un prospect. `select public.demo_reset();` remet la démo à neuf, avec des
-- dates recalculées par rapport à aujourd'hui. Le cron /api/cron/demo-refresh l'appelle chaque nuit.
--
-- Ce que la fonction touche : UNIQUEMENT les lignes du client démo.
--  * Les produits ne sont jamais supprimés (une suppression reviendrait par la synchro Airtable
--    et créerait des doublons) : ils sont remis à jour sur place.
--  * Commandes, ventes, stock, commandes fournisseurs, réceptions, commandes à vérifier, SAV,
--    notifications et changements de prix de la démo sont effacés puis recréés.
-- Sécurité : la fonction s'arrête si la boutique de la démo a un vrai jeton Shopify.
create or replace function public.demo_reset()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c uuid;
  s uuid;
  mb uuid;
  p record;
  d int;
  n int;
  i int;
  qty int;
  at timestamptz;
  rate numeric;
  total numeric;
  seq int := 1000;
  day_tag text := to_char(current_date, 'YYMMDD');
  o_where record;
  o_broken record;
  o_return record;
  o_late record;
  o_promo record;
  o_bulk record;
  th uuid;
  msg uuid;
  al uuid;
begin
  select id into c from clients where code = 'DEMO-PETITNUAGE';
  if c is null then
    return 'no demo client';
  end if;
  select id into s from shops where client_id = c order by created_at limit 1;
  if s is null then
    insert into shops (client_id, shopify_domain, status, last_synced_at)
    values (c, 'petit-nuage-demo.myshopify.com', 'active', now())
    returning id into s;
  end if;
  if exists (select 1 from shops where client_id = c and access_token_encrypted is not null) then
    return 'stopped: the demo store has a real Shopify token';
  end if;
  update shops set status = 'active', last_synced_at = now() where client_id = c;

  -- Reset demo data only (products are kept).
  delete from support_threads where client_id = c;
  delete from order_alerts where client_id = c;
  delete from purchase_orders where client_id = c;
  delete from inbound_cache where client_id = c;
  delete from notifications where client_id = c;
  delete from shopify_orders_cache where client_id = c;
  delete from sales_cache where client_id = c;
  delete from stock_cache where client_id = c;
  delete from sku_maps where client_id = c;
  delete from audit_log where client_id = c and action = 'product.price_changed';

  drop table if exists demo_live;
  drop table if exists demo_new;
  create temporary table demo_live (
    k text, title text, price numeric, cost numeric, weight int,
    rate numeric, trend text, stock int, age int
  ) on commit drop;
  insert into demo_live values
    ('VEILLEUSE', 'Veilleuse projecteur étoiles', 34.9, 6.2, 380, 9, 'up', 420, 120),
    ('TAPIS', 'Tapis d''éveil Montessori', 49.9, 11.5, 900, 5, 'flat', 160, 150),
    ('GOURDE', 'Gourde isotherme licorne', 24.9, 3.8, 260, 4, 'flat', 95, 140),
    ('NUAGE', 'Lampe de chevet nuage', 39.9, 7.4, 520, 6, 'drop', 28, 130),
    ('SAC', 'Sac à dos maternelle', 29.9, 5.1, 420, 3, 'slow', 210, 160),
    ('LIVRE', 'Livre sensoriel bébé', 19.9, 2.6, 240, 0.06, 'flat', 140, 100),
    ('PUZZLE', 'Puzzle bois animaux', 22.9, 3.2, 350, 0.1, 'new', 80, 12);

  create temporary table demo_new (
    k text, title text, status text, price numeric, cost numeric, weight int, descr text
  ) on commit drop;
  insert into demo_new values
    ('TROTTINETTE', 'Trottinette 3 roues lumineuse', 'brief_received', null, null, null,
      'Trottinette 3 roues pliable avec roues LED, 2-5 ans, guidon réglable.'),
    ('DOUDOU', 'Doudou bruit blanc mouton', 'samples', null, null, null,
      'Peluche mouton avec bruit blanc et berceuses, minuterie 30 min, rechargeable USB-C.'),
    ('TIPI', 'Tente tipi enfant', 'quote_sent', 59.9, 14.8, 2100,
      'Tipi en coton 4 pans, 160 cm, tapis de sol et guirlande inclus.');

  -- Live catalogue: updated in place, created only when missing.
  update products_cache pc
  set sku = 'PN-' || l.k, title = l.title, created_date = current_date - l.age,
      sourcing_status = 'validated', selling_price = l.price, weight_g = l.weight,
      shipping_channel = 'standard', client_price = l.cost,
      migration_state = 'imported_pending', production_lead_days = 12, moq = 200,
      lifecycle_status = 'testing'
  from demo_live l
  where pc.client_id = c and (pc.sku = 'PN-' || l.k or pc.title = l.title);

  insert into products_cache (
    client_id, airtable_record_id, sku, title, created_date, lifecycle_status, sourcing_status,
    quote_json, selling_price, weight_g, shipping_channel, client_price, migration_state,
    production_lead_days, moq
  )
  select c, 'pending:demo-' || lower(l.k), 'PN-' || l.k, l.title, current_date - l.age, 'testing',
    'validated',
    jsonb_build_object('_request', jsonb_build_object('destination_markets', 'FR')),
    l.price, l.weight, 'standard', l.cost, 'imported_pending', 12, 200
  from demo_live l
  where not exists (select 1 from products_cache pc where pc.client_id = c and pc.sku = 'PN-' || l.k);

  -- Products in the sourcing pipeline (one quote waiting for the client).
  update products_cache pc
  set created_date = current_date - 6, lifecycle_status = 'testing',
      sourcing_status = w.status::sourcing_status, selling_price = w.price, weight_g = w.weight,
      shipping_channel = case when w.weight is null then null else 'standard'::shipping_channel end,
      client_price = w.cost, accepted_quote_snapshot_json = null,
      moq = case when w.status = 'quote_sent' then 300 else null end,
      production_lead_days = case when w.status = 'quote_sent' then 15 else null end
  from demo_new w
  where pc.client_id = c and pc.title = w.title;

  insert into products_cache (
    client_id, airtable_record_id, title, created_date, lifecycle_status, sourcing_status,
    quote_json, selling_price, weight_g, shipping_channel, client_price, moq, production_lead_days
  )
  select c, 'pending:demo-' || lower(w.k), w.title, current_date - 6, 'testing',
    w.status::sourcing_status,
    jsonb_build_object('_request', jsonb_build_object(
      'description', w.descr, 'destination_markets', 'FR', 'expected_launch_qty', 300)),
    w.price, w.weight, case when w.weight is null then null else 'standard'::shipping_channel end,
    w.cost, case when w.status = 'quote_sent' then 300 else null end,
    case when w.status = 'quote_sent' then 15 else null end
  from demo_new w
  where not exists (select 1 from products_cache pc where pc.client_id = c and pc.title = w.title);

  -- 90 days of orders ending today: 1 to 3 units, some repeat customers.
  for p in select * from demo_live loop
    for d in 0..89 loop
      exit when d > p.age;
      rate := case p.trend
        when 'up' then p.rate * (0.45 + (89 - d) / 89.0 * 0.9)
        when 'drop' then case when d < 14 then p.rate * 0.3 else p.rate end
        when 'slow' then p.rate * (0.6 + d / 89.0 * 0.8)
        else p.rate end;
      n := floor(rate + random())::int;
      for i in 1..n loop
        qty := case when random() < 0.68 then 1 when random() < 0.75 then 2 else 3 end;
        at := now() - make_interval(days => d) - make_interval(secs => floor(random() * 86400)::int);
        total := round(qty * p.price + case when qty = 1 then 4.90 else 0 end, 2);
        seq := seq + 1;
        insert into shopify_orders_cache (
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

  -- Two unusual orders for « Commandes à vérifier ».
  select * into o_promo from shopify_orders_cache
  where client_id = c and not cancelled and order_date = current_date - 1
    and line_items_json -> 1 ->> 'sku' = 'PN-TAPIS' order by placed_at desc limit 1;
  select * into o_bulk from shopify_orders_cache
  where client_id = c and not cancelled and order_date = current_date - 6
    and line_items_json -> 1 ->> 'sku' = 'PN-VEILLEUSE' order by placed_at desc limit 1;
  if o_promo.id is not null then
    update shopify_orders_cache
    set line_items_json = jsonb_build_array(
      jsonb_build_object('_order', jsonb_build_object(
        'fulfilled', false, 'total', 19.96, 'currency', 'EUR', 'units', 2)),
      jsonb_build_object('sku', 'PN-TAPIS', 'quantity', 2, 'title', 'Tapis d''éveil Montessori', 'price', 49.9))
    where id = o_promo.id;
    insert into order_alerts (client_id, shop_id, shopify_order_id, order_number, placed_at, reasons, details, status, created_at)
    values (c, s, o_promo.shopify_order_id, o_promo.order_number, o_promo.placed_at,
      array['discount_abuse'],
      jsonb_build_object('total', 19.96, 'gross', 99.80, 'discounts', 79.84, 'discount_pct', 80,
        'discount_codes', jsonb_build_array('BIENVENUE10', 'VIP80'), 'units', 2, 'currency', 'EUR'),
      'open', o_promo.placed_at + interval '10 minutes')
    returning id into al;
    insert into order_alert_messages (alert_id, client_id, author_role, body, created_at) values
      (al, c, 'voltship', 'Bonjour, cette commande cumule deux codes promo (−80 %). On la met en attente : tu veux qu''on l''expédie quand même ?',
        o_promo.placed_at + interval '25 minutes');
  end if;
  if o_bulk.id is not null then
    update shopify_orders_cache
    set line_items_json = jsonb_build_array(
      jsonb_build_object('_order', jsonb_build_object(
        'fulfilled', true, 'total', 418.80, 'currency', 'EUR', 'units', 12)),
      jsonb_build_object('sku', 'PN-VEILLEUSE', 'quantity', 12, 'title', 'Veilleuse projecteur étoiles', 'price', 34.9))
    where id = o_bulk.id;
    insert into order_alerts (client_id, shop_id, shopify_order_id, order_number, placed_at, reasons, details, status, resolved_at, created_at)
    values (c, s, o_bulk.shopify_order_id, o_bulk.order_number, o_bulk.placed_at,
      array['quantity_spike'],
      jsonb_build_object('total', 418.80, 'gross', 418.80, 'discounts', 0, 'discount_pct', 0,
        'discount_codes', jsonb_build_array(), 'units', 12, 'currency', 'EUR'),
      'legit', o_bulk.placed_at + interval '5 hours', o_bulk.placed_at + interval '10 minutes')
    returning id into al;
    insert into order_alert_messages (alert_id, client_id, author_role, body, created_at) values
      (al, c, 'voltship', 'Bonjour, 12 veilleuses sur une seule commande, pour la même adresse. On vérifie avec toi avant d''expédier.',
        o_bulk.placed_at + interval '30 minutes'),
      (al, c, 'client', 'Oui c''est une crèche qui nous a écrit avant de commander, c''est bon pour moi.',
        o_bulk.placed_at + interval '4 hours'),
      (al, c, 'voltship', 'Parfait, la commande part aujourd''hui.', o_bulk.placed_at + interval '5 hours');
  end if;

  -- Daily sales (what the lifecycle rule and the stock days read).
  insert into sales_cache (client_id, shop_id, sku, date, units_sold)
  select c, s, line ->> 'sku', o.order_date, sum((line ->> 'quantity')::int)
  from shopify_orders_cache o
  cross join lateral jsonb_array_elements(o.line_items_json) line
  where o.client_id = c and not o.cancelled and line ? 'sku'
  group by line ->> 'sku', o.order_date;

  insert into sku_maps (client_id, shop_id, shopify_sku, airtable_record_id)
  select c, s, pc.sku, pc.airtable_record_id
  from products_cache pc
  where pc.client_id = c and pc.sku like 'PN-%';

  -- Warehouse stock (the cloud lamp is close to running out, 300 units on the way).
  insert into stock_cache (client_id, sku, qty_available, inbound_qty, last_synced_at)
  select c, 'PN-' || k, stock, case when k = 'NUAGE' then 300 else 0 end, now() from demo_live;

  -- Lifecycle with Voltship's rule (5 sales over 14 days = winning).
  update products_cache pc set lifecycle_status = x.status::lifecycle_status
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
      from sales_cache where client_id = c group by sku
    ) agg on agg.sku = 'PN-' || l.k
  ) x
  where pc.client_id = c and pc.sku = 'PN-' || x.k;

  -- Supplier orders placed by Voltship (« Mes commandes »).
  insert into purchase_orders (
    client_id, product_id, reference, title, quantity, unit_price_eur, total_eur, status, eta,
    tracking, notes_client, history, paid_at, received_at, created_at, updated_at
  )
  select c, pc.id, 'PO-DEMO-' || day_tag || '-' || v.n, pc.title, v.qty, pc.client_price,
    round(v.qty * pc.client_price, 2), v.status,
    case when v.eta_days is null then null else current_date + v.eta_days end,
    v.tracking, v.note,
    (select jsonb_agg(jsonb_build_object('status', h.status, 'at', now() - make_interval(days => h.days_ago)) order by h.days_ago desc)
     from (values ('to_pay', v.age), ('in_production', v.age - 1), ('quality_check', v.age - 14),
                  ('to_warehouse', v.age - 17), ('received', v.age - 22)) as h(status, days_ago)
     where h.days_ago >= v.floor_days),
    now() - make_interval(days => v.age - 1),
    case when v.status = 'received' then now() - make_interval(days => v.age - 22) else null end,
    now() - make_interval(days => v.age), now() - make_interval(days => v.floor_days)
  from (values
    (1, 'PN-TAPIS', 500, 'received', null::int, null::text, 'Reçu et rangé : 498 pièces conformes, 2 écartées au contrôle.', 41, 19),
    (2, 'PN-NUAGE', 300, 'to_warehouse', 4, 'SF1482009913CN', 'Parti de l''usine, arrivée à l''entrepôt dans 4 jours.', 19, 2),
    (3, 'PN-GOURDE', 400, 'quality_check', 6, null, 'Contrôle qualité en cours à l''usine : photos envoyées demain.', 15, 1),
    (4, 'PN-VEILLEUSE', 1000, 'in_production', 16, null, 'Production lancée, fin prévue dans 12 jours.', 4, 3)
  ) as v(n, sku, qty, status, eta_days, tracking, note, age, floor_days)
  join products_cache pc on pc.client_id = c and pc.sku = v.sku;

  -- Goods on their way to the warehouse (« Réceptions »).
  insert into inbound_cache (
    client_id, reference_no, status, qty_announced, qty_received, items_json, tracking_no, eta,
    expected_at, received_at, putaway_at, product_id, qc_defect_rate, updated_at
  )
  select c, v.ref, v.status::inbound_status, v.announced, v.received,
    jsonb_build_array(jsonb_build_object('sku', v.sku, 'quantity', v.announced)), v.tracking,
    current_date + v.eta_days, now() + make_interval(days => v.eta_days),
    case when v.received_ago is null then null else now() - make_interval(days => v.received_ago) end,
    case when v.status = 'stocked' then now() - make_interval(days => v.received_ago - 1) else null end,
    pc.id, v.defect, now() - make_interval(hours => v.updated_hours)
  from (values
    ('ASN-PN-0035', 'PN-NUAGE', 'announced', 300, 0, 'SF1482009913CN', 4, null::int, null::numeric, 30),
    ('ASN-PN-0034', 'PN-GOURDE', 'qc_in_progress', 400, 400, 'YT7730551208', -1, 1, null, 20),
    ('ASN-PN-0031', 'PN-TAPIS', 'stocked', 500, 498, 'SF1479920355CN', -20, 20, 0.004, 456)
  ) as v(ref, sku, status, announced, received, tracking, eta_days, received_ago, defect, updated_hours)
  join products_cache pc on pc.client_id = c and pc.sku = v.sku;

  -- SAV: a demo mailbox (token « demo »: never synced, nothing is ever sent) and four threads.
  select id into mb from support_mailboxes where client_id = c order by created_at limit 1;
  if mb is null then
    insert into support_mailboxes (client_id, provider, email_address, refresh_token_encrypted, enabled, last_sync_at)
    values (c, 'gmail', 'contact@petit-nuage-demo.com', 'demo', true, now())
    returning id into mb;
  else
    update support_mailboxes
    set refresh_token_encrypted = 'demo', enabled = true, sync_error = null, last_sync_at = now()
    where id = mb;
  end if;

  select * into o_where from shopify_orders_cache
  where client_id = c and not cancelled and order_date = current_date - 5
    and line_items_json -> 1 ->> 'sku' = 'PN-VEILLEUSE' order by placed_at limit 1;
  select * into o_broken from shopify_orders_cache
  where client_id = c and not cancelled and order_date = current_date - 12
    and line_items_json -> 1 ->> 'sku' = 'PN-NUAGE' order by placed_at limit 1;
  select * into o_return from shopify_orders_cache
  where client_id = c and not cancelled and order_date = current_date - 16
    and line_items_json -> 1 ->> 'sku' = 'PN-GOURDE' order by placed_at limit 1;
  select * into o_late from shopify_orders_cache
  where client_id = c and not cancelled and order_date = current_date - 9
    and line_items_json -> 1 ->> 'sku' = 'PN-TAPIS' order by placed_at limit 1;

  -- 1. Where is my order: waiting, with a suggested reply.
  insert into support_threads (client_id, mailbox_id, provider_thread_id, subject, customer_name, status,
    matched_order_number, matched_order_id, last_message_at, last_direction, snippet, created_at)
  values (c, mb, 'demo-thread-1', 'Où en est ma commande ?', 'Camille R.', 'open',
    o_where.order_number, o_where.id, now() - interval '2 hours', 'in',
    'Bonjour, j''ai commandé une veilleuse il y a 5 jours et je n''ai pas de nouvelles…', now() - interval '2 hours')
  returning id into th;
  insert into support_messages (thread_id, provider_message_id, direction, from_name, body_text, received_at)
  values (th, 'demo-msg-' || th || '-1', 'in', 'Camille R.',
    'Bonjour,' || E'\n\n' || 'J''ai commandé une veilleuse projecteur étoiles il y a 5 jours (commande n° ' || coalesce(o_where.order_number, '—') || ') et je n''ai pas de nouvelles. C''est pour un anniversaire samedi, pouvez-vous me dire où en est le colis ?' || E'\n\n' || 'Merci,' || E'\n' || 'Camille',
    now() - interval '2 hours');
  insert into support_drafts (thread_id, body_text, intent, confidence, generated_at)
  values (th,
    'Bonjour Camille,' || E'\n\n' || 'Merci pour votre message. Votre commande n° ' || coalesce(o_where.order_number, '—') || ' a bien été expédiée de notre entrepôt et elle est en cours d''acheminement. La livraison est prévue sous 3 à 5 jours ouvrés, donc avant samedi.' || E'\n\n' || 'Vous recevrez un e-mail du transporteur dès que le colis sera en cours de livraison.' || E'\n\n' || 'Belle journée,' || E'\n' || 'L''équipe Petit Nuage',
    'where_is_my_order', 0.93, now() - interval '119 minutes');

  -- 2. Damaged item: waiting, with a suggested reply.
  insert into support_threads (client_id, mailbox_id, provider_thread_id, subject, customer_name, status,
    matched_order_number, matched_order_id, last_message_at, last_direction, snippet, created_at)
  values (c, mb, 'demo-thread-2', 'Lampe nuage arrivée fêlée', 'Thomas L.', 'open',
    o_broken.order_number, o_broken.id, now() - interval '7 hours', 'in',
    'Bonjour, la lampe nuage est arrivée avec le socle fêlé…', now() - interval '7 hours')
  returning id into th;
  insert into support_messages (thread_id, provider_message_id, direction, from_name, body_text, received_at)
  values (th, 'demo-msg-' || th || '-1', 'in', 'Thomas L.',
    'Bonjour,' || E'\n\n' || 'La lampe de chevet nuage est arrivée ce matin avec le socle fêlé (commande ' || coalesce(o_broken.order_number, '—') || '). Elle s''allume mais elle ne tient pas droite. Que proposez-vous ?' || E'\n\n' || 'Thomas',
    now() - interval '7 hours');
  insert into support_drafts (thread_id, body_text, intent, confidence, generated_at)
  values (th,
    'Bonjour Thomas,' || E'\n\n' || 'Nous sommes désolés pour cette mauvaise surprise. Nous vous renvoyons une lampe neuve dès aujourd''hui, sans frais, et vous n''avez pas besoin de nous retourner la première.' || E'\n\n' || 'Pourriez-vous simplement nous envoyer une photo du socle ? Elle nous sert à signaler le défaut à notre atelier.' || E'\n\n' || 'Bien à vous,' || E'\n' || 'L''équipe Petit Nuage',
    'damaged', 0.86, now() - interval '419 minutes');

  -- 3. Return request: answered.
  insert into support_threads (client_id, mailbox_id, provider_thread_id, subject, customer_name, status,
    matched_order_number, matched_order_id, last_message_at, last_direction, snippet, created_at)
  values (c, mb, 'demo-thread-3', 'Retour gourde licorne', 'Inès M.', 'answered',
    o_return.order_number, o_return.id, now() - interval '1 day', 'out',
    'Bonjour Inès, bien sûr : vous avez 30 jours pour nous la retourner…', now() - interval '2 days')
  returning id into th;
  insert into support_messages (thread_id, provider_message_id, direction, from_name, body_text, received_at)
  values (th, 'demo-msg-' || th || '-1', 'in', 'Inès M.',
    'Bonjour, ma fille préférait finalement le modèle dinosaure. Est-ce que je peux vous retourner la gourde licorne ? Elle n''a pas servi.',
    now() - interval '2 days');
  insert into support_messages (thread_id, provider_message_id, direction, body_text, received_at, sent_at)
  values (th, 'demo-msg-' || th || '-2', 'out',
    'Bonjour Inès,' || E'\n\n' || 'Bien sûr : vous avez 30 jours pour nous la retourner. Voici l''étiquette de retour en pièce jointe, le remboursement part dès réception du colis.' || E'\n\n' || 'Belle journée,' || E'\n' || 'L''équipe Petit Nuage',
    now() - interval '1 day', now() - interval '1 day')
  returning id into msg;
  insert into support_drafts (thread_id, body_text, intent, confidence, generated_at, approved_at, sent_message_id)
  values (th, 'Bonjour Inès, bien sûr : vous avez 30 jours pour nous la retourner.', 'return', 0.9,
    now() - interval '2 days', now() - interval '1 day', msg);

  -- 4. Delivery delay: closed.
  insert into support_threads (client_id, mailbox_id, provider_thread_id, subject, customer_name, status,
    matched_order_number, matched_order_id, last_message_at, last_direction, snippet, created_at)
  values (c, mb, 'demo-thread-4', 'Livraison plus longue que prévu', 'Sophie B.', 'closed',
    o_late.order_number, o_late.id, now() - interval '3 days', 'in',
    'Merci beaucoup, le colis est bien arrivé ce matin !', now() - interval '5 days')
  returning id into th;
  insert into support_messages (thread_id, provider_message_id, direction, from_name, body_text, received_at)
  values (th, 'demo-msg-' || th || '-1', 'in', 'Sophie B.',
    'Bonjour, le suivi de mon tapis d''éveil n''a pas bougé depuis 4 jours. Est-ce normal ?', now() - interval '5 days');
  insert into support_messages (thread_id, provider_message_id, direction, body_text, received_at, sent_at)
  values (th, 'demo-msg-' || th || '-2', 'out',
    'Bonjour Sophie,' || E'\n\n' || 'Votre colis est bien en route : il a été ralenti au passage en douane et repart aujourd''hui. Il devrait arriver sous 2 à 3 jours.' || E'\n\n' || 'L''équipe Petit Nuage',
    now() - interval '5 days' + interval '3 hours', now() - interval '5 days' + interval '3 hours')
  returning id into msg;
  insert into support_drafts (thread_id, body_text, intent, confidence, generated_at, approved_at, sent_message_id)
  values (th, 'Bonjour Sophie, votre colis est bien en route.', 'delivery_delay', 0.88,
    now() - interval '5 days', now() - interval '5 days' + interval '3 hours', msg);
  insert into support_messages (thread_id, provider_message_id, direction, from_name, body_text, received_at)
  values (th, 'demo-msg-' || th || '-3', 'in', 'Sophie B.',
    'Merci beaucoup, le colis est bien arrivé ce matin !', now() - interval '3 days');

  -- Prices that changed (« Prix qui ont changé » on the products page).
  insert into audit_log (client_id, action, entity, diff_json, created_at)
  select c, 'product.price_changed', pc.id::text,
    jsonb_build_object('market', 'FR', 'before', v.before, 'after', v.after),
    now() - make_interval(days => v.days_ago)
  from (values ('PN-GOURDE', 12.35, 11.73, 9), ('PN-VEILLEUSE', 16.40, 15.82, 9), ('PN-SAC', 14.70, 15.11, 23))
    as v(sku, before, after, days_ago)
  join products_cache pc on pc.client_id = c and pc.sku = v.sku;

  -- Notifications.
  insert into notifications (client_id, type, payload_json, channels, created_at, read_at)
  select c, v.type,
    jsonb_strip_nulls(jsonb_build_object('message', v.message, 'href', v.href,
      'productId', (select id from products_cache pc where pc.client_id = c and (pc.sku = v.ref or pc.title = v.ref) limit 1))),
    array['in_app'], now() - make_interval(hours => v.hours_ago),
    case when v.is_read then now() - make_interval(hours => v.hours_ago - 1) else null end
  from (values
    ('support_new_messages', 'SAV : 2 nouveaux messages client', '/support', null::text, 2, false),
    ('quote_ready', 'Ton devis pour « Tente tipi enfant » est prêt : prix livré et délai à valider.', null, 'Tente tipi enfant', 3, false),
    ('order_alert', 'Commande à vérifier : deux codes promo cumulés (−80 %).', '/alerts', null, 20, false),
    ('lifecycle_changed', 'Veilleuse projecteur étoiles passe en Winning 🔥', null, 'PN-VEILLEUSE', 26, false),
    ('purchase_order', 'Ta commande de 300 Lampe de chevet nuage est en route vers l''entrepôt.', '/orders', null, 44, false),
    ('lifecycle_changed', 'Lampe de chevet nuage ralentit : ventes divisées par deux sur 14 jours.', null, 'PN-NUAGE', 50, true),
    ('purchase_order', 'Production lancée : 1 000 Veilleuse projecteur étoiles.', '/orders', null, 72, true),
    ('purchase_order', 'Ta commande de 500 Tapis d''éveil Montessori est reçue et rangée.', '/orders', null, 456, true)
  ) as v(type, message, href, ref, hours_ago, is_read);

  return 'ok ' || (select count(*) from shopify_orders_cache where client_id = c) || ' orders';
end;
$$;

revoke all on function public.demo_reset() from public, anon, authenticated;
