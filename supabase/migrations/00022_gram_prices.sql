-- Gram-exact transport billing: client price and carrier cost for every gram of a bracket
-- (index 1 = weight_min_g). Null = flat bracket price (older grids, manual cells).
alter table public.rate_grid_cells
  add column if not exists gram_prices numeric[],
  add column if not exists gram_costs_rmb numeric[];
