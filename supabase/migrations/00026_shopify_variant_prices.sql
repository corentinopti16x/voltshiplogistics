-- Prix par variante Shopify : nom et prix de vente de chaque variante, et nombre de pièces
-- qu'elle contient (lot de 10, pack de 4…). `pack_units` vide = deviné d'après le nom.
alter table public.shopify_products_cache
  add column if not exists variant_title text,
  add column if not exists price numeric(12, 2),
  add column if not exists pack_units integer
    check (pack_units is null or (pack_units between 1 and 500));
