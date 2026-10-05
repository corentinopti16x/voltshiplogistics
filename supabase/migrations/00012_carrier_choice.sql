-- Voltship Client App — Carrier line choice per product × market + admin restrictions
-- Run in the Supabase SQL editor AFTER 00011. Safe to re-run.
--
-- * clients.carrier_rules_json: admin rules applied to every live COGS calculation of the
--   client: { "blocked": ["YunExpress|THPHR-CHC", …], "forced": { "FR": { "carrier", "lineName" } } }.
--   A blocked line is never picked nor offered; a forced line replaces the client's choice on
--   that market (fallback to the cheapest allowed line when it has no bracket at the weight).
-- * The client's own choice lives in products_cache.quote_json._carrier_pref:
--   { "FR": { "carrier": "YunExpress", "lineName": "CHC" } } (absent/null = cheapest, auto).
--   No schema change: quote_json is already a jsonb column written by the service role.
-- * Accepted quotes (accepted_quote_snapshot_json) stay frozen as before.

alter table public.clients
  add column if not exists carrier_rules_json jsonb not null default '{}'::jsonb;

comment on column public.clients.carrier_rules_json is
  'Admin carrier rules: { blocked: ["Carrier|Line"], forced: { "<ISO2>": { carrier, lineName } } }. Applied on every live COGS computation and on ECCANG order push.';
