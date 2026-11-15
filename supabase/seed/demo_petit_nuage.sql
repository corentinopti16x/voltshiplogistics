-- Compte DÉMO « Petit Nuage » : données 100 % fictives.
-- Tout est dans la fonction public.demo_reset() (migration 00027_demo_reset.sql), appelée chaque
-- nuit par le cron /api/cron/demo-refresh. Pour remettre la démo à neuf tout de suite :
select public.demo_reset();
