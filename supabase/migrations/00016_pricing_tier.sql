-- Paliers clients Voltship : Ultra VIP / VIP / Platinium / Gold.
-- Remplace l'ancien champ « Offre » (bronze/silver/gold/scale, hérité de la V1, qui ne réglait
-- que les quotas de recherche marketing). Le palier pré-remplit remise / commission / handling.
alter table public.clients
  add column if not exists pricing_tier text;

alter table public.clients
  drop constraint if exists clients_pricing_tier_check;
alter table public.clients
  add constraint clients_pricing_tier_check
  check (pricing_tier is null or pricing_tier in ('ultra_vip', 'vip', 'platinium', 'gold'));

-- Palier déduit des tarifs déjà réglés (ex. BRIAG 5 % / 5 % → VIP, MELVYN 7 % → Platinium).
update public.clients
set pricing_tier = case
  when coalesce(logistics_discount_pct, 0) >= 10 then 'ultra_vip'
  when coalesce(logistics_discount_pct, 0) >= 5 then 'vip'
  when commission_pct > 0 and commission_pct <= 3 then 'ultra_vip'
  when commission_pct > 0 and commission_pct <= 5 then 'vip'
  when commission_pct > 0 and commission_pct <= 7 then 'platinium'
  else 'gold'
end
where pricing_tier is null;
