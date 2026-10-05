"use client";

import { useActionState, useMemo, useState } from "react";
import { importShopifyProductsAction } from "@/app/actions/shopify";
import type { ActionResult } from "@/app/actions/admin";

const initial: ActionResult = { ok: false };

export function ShopifyImportForm({
  products,
}: {
  products: Array<{
    id: string;
    title: string;
    sku: string | null;
    units_90d: number;
    imported_product_id: string | null;
    shopName: string;
  }>;
}) {
  const [state, action, pending] = useActionState(importShopifyProductsAction, initial);
  const [salesSort, setSalesSort] = useState<"desc" | "asc">("desc");
  const available = products.filter((product) => !product.imported_product_id);
  const visible = useMemo(
    () =>
      [...products].sort((a, b) =>
        salesSort === "desc" ? b.units_90d - a.units_90d : a.units_90d - b.units_90d,
      ),
    [products, salesSort],
  );

  return (
    <form action={action}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--muted)]">Sort by sales</span>
          <select
            value={salesSort}
            onChange={(event) => setSalesSort(event.target.value === "asc" ? "asc" : "desc")}
            className="cursor-pointer rounded-md border border-[var(--line)] bg-white px-3 py-2"
          >
            <option value="desc">Highest first</option>
            <option value="asc">Lowest first</option>
          </select>
        </label>
        <p className="text-xs text-[var(--muted)]">{visible.length} products</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-y border-[var(--line)] text-xs text-[var(--muted)] uppercase">
            <tr>
              <th className="px-4 py-3">Import</th>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Shop</th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => setSalesSort((current) => (current === "desc" ? "asc" : "desc"))}
                  className="cursor-pointer"
                >
                  90-day units {salesSort === "desc" ? "↓" : "↑"}
                </button>
              </th>
              <th className="px-4 py-3">State</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((product) => (
              <tr key={product.id} className="border-b border-[var(--line)]">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    name="product_ids"
                    value={product.id}
                    disabled={Boolean(product.imported_product_id)}
                    defaultChecked={!product.imported_product_id && product.units_90d >= 30}
                  />
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium">{product.title}</p>
                  <p className="text-xs text-[var(--muted)]">{product.sku ?? "No SKU"}</p>
                </td>
                <td className="px-4 py-3">{product.shopName}</td>
                <td className="px-4 py-3">{product.units_90d}</td>
                <td className="px-4 py-3">
                  {product.imported_product_id ? "Imported" : "Ready"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.error ? <p className="mt-4 text-sm text-red-700">{state.error}</p> : null}
      {state.ok ? <p className="mt-4 text-sm text-emerald-800">Products imported.</p> : null}
      <button
        type="submit"
        disabled={pending || available.length === 0}
        className="m-4 cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Importing…" : "Import selected winners"}
      </button>
    </form>
  );
}
