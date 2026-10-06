"use client";

import { Fragment, useActionState, useMemo, useState } from "react";
import { importShopifyProductsAction } from "@/app/actions/shopify";
import type { ActionResult } from "@/app/actions/admin";

const initial: ActionResult = { ok: false };

/** Minimum 90-day units (summed over all variants) for a product to be preselected. */
export const WINNER_THRESHOLD = 30;

export type ImportVariantRow = {
  id: string;
  shopifyProductId: string;
  title: string;
  sku: string | null;
  units_90d: number;
  imported_product_id: string | null;
};

type ProductGroup = {
  key: string;
  title: string;
  variants: ImportVariantRow[];
  units: number;
  pendingIds: string[];
  imported: boolean;
};

function groupVariants(rows: ImportVariantRow[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>();
  for (const row of rows) {
    const key = row.shopifyProductId || row.id;
    const group =
      groups.get(key) ??
      { key, title: row.title, variants: [], units: 0, pendingIds: [], imported: false };
    group.variants.push(row);
    group.units += row.units_90d;
    if (row.imported_product_id) group.imported = true;
    else group.pendingIds.push(row.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function ShopifyImportForm({ products }: { products: ImportVariantRow[] }) {
  const [state, action, pending] = useActionState(importShopifyProductsAction, initial);
  const [query, setQuery] = useState("");
  const [onlyPending, setOnlyPending] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => groupVariants(products), [products]);
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      groupVariants(products).map((g) => [g.key, !g.imported && g.units >= WINNER_THRESHOLD]),
    ),
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .filter((g) => (onlyPending ? g.pendingIds.length > 0 : true))
      .filter(
        (g) =>
          !q ||
          g.title.toLowerCase().includes(q) ||
          g.variants.some((v) => (v.sku ?? "").toLowerCase().includes(q)),
      )
      .sort((a, b) => b.units - a.units);
  }, [groups, query, onlyPending]);

  const selectedGroups = groups.filter((g) => selected[g.key] && g.pendingIds.length > 0);
  const setAll = (value: boolean) =>
    setSelected((current) => ({
      ...current,
      ...Object.fromEntries(visible.filter((g) => g.pendingIds.length).map((g) => [g.key, value])),
    }));

  return (
    <form action={action}>
      {selectedGroups.flatMap((g) =>
        g.pendingIds.map((id) => <input key={id} type="hidden" name="product_ids" value={id} />),
      )}
      <div className="flex flex-wrap items-center gap-3 px-6 pb-4">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher un produit ou un SKU…"
          className="min-w-56 flex-1 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyPending}
            onChange={(event) => setOnlyPending(event.target.checked)}
          />
          <span className="text-[var(--muted)]">Masquer les déjà importés</span>
        </label>
        <button
          type="button"
          onClick={() => setAll(true)}
          className="cursor-pointer rounded-md border border-[var(--line)] px-3 py-1.5 text-sm"
        >
          Tout cocher
        </button>
        <button
          type="button"
          onClick={() => setAll(false)}
          className="cursor-pointer rounded-md border border-[var(--line)] px-3 py-1.5 text-sm"
        >
          Tout décocher
        </button>
        <p className="text-xs text-[var(--muted)]">
          {visible.length} produits · {selectedGroups.length} sélectionnés
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-y border-[var(--line)] text-xs text-[var(--muted)] uppercase">
            <tr>
              <th className="px-4 py-3">Importer</th>
              <th className="px-4 py-3">Produit</th>
              <th className="px-4 py-3">Variantes</th>
              <th className="px-4 py-3">Ventes 90 j ↓</th>
              <th className="px-4 py-3">État</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((group) => (
              <Fragment key={group.key}>
                <tr className="border-b border-[var(--line)]">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Importer ${group.title}`}
                      disabled={group.pendingIds.length === 0}
                      checked={Boolean(selected[group.key]) && group.pendingIds.length > 0}
                      onChange={(event) =>
                        setSelected((current) => ({ ...current, [group.key]: event.target.checked }))
                      }
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{group.title}</p>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setOpen((c) => ({ ...c, [group.key]: !c[group.key] }))}
                      className="cursor-pointer text-[var(--muted)] underline-offset-2 hover:underline"
                    >
                      {group.variants.length} {open[group.key] ? "▴" : "▾"}
                    </button>
                  </td>
                  <td className="px-4 py-3 font-medium">{group.units}</td>
                  <td className="px-4 py-3">
                    {group.pendingIds.length === 0
                      ? "Importé"
                      : group.imported
                        ? "Partiel"
                        : "Prêt"}
                  </td>
                </tr>
                {open[group.key]
                  ? group.variants.map((variant) => (
                      <tr key={variant.id} className="border-b border-[var(--line)] bg-white/50 text-xs">
                        <td />
                        <td className="px-4 py-2 text-[var(--muted)]">{variant.sku ?? "Sans SKU"}</td>
                        <td />
                        <td className="px-4 py-2">{variant.units_90d}</td>
                        <td className="px-4 py-2">{variant.imported_product_id ? "Importé" : ""}</td>
                      </tr>
                    ))
                  : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {state.error ? <p className="mx-6 mt-4 text-sm text-red-700">{state.error}</p> : null}
      {state.ok ? (
        <p className="mx-6 mt-4 text-sm text-emerald-800">
          {state.clientId ?? "0"} produit(s) importé(s).
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || selectedGroups.length === 0}
        className="m-4 cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Import…" : `Importer ${selectedGroups.length} produit(s)`}
      </button>
    </form>
  );
}
