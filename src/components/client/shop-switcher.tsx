"use client";

import { setActiveShopAction } from "@/app/actions/shop-switch";

export function ShopSwitcher({
  shops,
  active,
  allLabel,
}: {
  shops: Array<{ id: string; label: string }>;
  active: string | null;
  allLabel: string;
}) {
  return (
    <form action={setActiveShopAction}>
      <label className="sr-only" htmlFor="shop-switcher">
        Boutique
      </label>
      <select
        id="shop-switcher"
        name="shop"
        defaultValue={active ?? "all"}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="cursor-pointer rounded-[10px] border border-white/25 bg-white/10 px-3 py-2 text-[13px] font-semibold text-white"
      >
        <option value="all" className="text-[var(--navy)]">
          {allLabel}
        </option>
        {shops.map((shop) => (
          <option key={shop.id} value={shop.id} className="text-[var(--navy)]">
            {shop.label}
          </option>
        ))}
      </select>
    </form>
  );
}
