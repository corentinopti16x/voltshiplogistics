import { createAdminClient } from "@/lib/supabase/admin";
import { saveShopifyAppCredentialsAction, syncShopAction } from "@/app/actions/shopify";
import { ShopifyImportForm } from "@/components/admin/shopify-import-form";
import { DisconnectShopButton } from "@/components/admin/disconnect-shop-button";

export default async function AdminShopsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; shop?: string }>;
}) {
  const query = await searchParams;
  const admin = createAdminClient();
  const { data: shopOptions } = await admin
    .from("shops")
    .select("id, shopify_domain, status, clients!inner(name)")
    .order("created_at", { ascending: false });
  const shopLabel = (shop: { shopify_domain: string; clients: unknown }) => {
    const client = Array.isArray(shop.clients) ? shop.clients[0] : shop.clients;
    return `${(client as { name?: string } | null)?.name ?? "?"} · ${shop.shopify_domain}`;
  };
  const selectedShopId =
    (shopOptions ?? []).find((shop) => shop.id === query.shop)?.id ??
    (shopOptions ?? []).find((shop) => shop.status === "active")?.id ??
    null;
  const [{ data: clients }, { data: shops }, { data: products }, { data: apps }] = await Promise.all([
    admin.from("clients").select("id, name").order("name"),
    admin
      .from("shops")
      .select("id, client_id, shopify_domain, status, last_synced_at, sync_error, clients!inner(name)")
      .order("created_at", { ascending: false }),
    selectedShopId
      ? admin
          .from("shopify_products_cache")
          .select("id, shopify_product_id, title, sku, units_90d, imported_product_id")
          .eq("shop_id", selectedShopId)
          .order("units_90d", { ascending: false })
          .limit(5000)
      : Promise.resolve({ data: [] as never[] }),
    admin
      .from("shopify_app_credentials")
      .select("*")
      .order("shopify_domain"),
  ]);

  const importRows = (products ?? []).map((product) => ({
    id: product.id,
    shopifyProductId: product.shopify_product_id,
    title: product.title,
    sku: product.sku,
    units_90d: Number(product.units_90d),
    imported_product_id: product.imported_product_id,
  }));

  return (
    <div>
      <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">
        Voltship admin
      </p>
      <h1 className="font-display mt-2 text-3xl">Shopify migration</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Connect sends you to Shopify’s install screen for the chosen store (OAuth). Once the
        merchant approves, the shop is saved and 90 days of orders plus the catalogue are imported.
        Clients can also connect their own store from Settings.
      </p>
      {query.connected ? (
        <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Shop connected. Review the imported products below.
        </p>
      ) : null}
      {query.error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{query.error}</p>
      ) : null}

      <section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">Apps Shopify par boutique</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Une app « Custom distribution » par boutique client (Dev Dashboard de l’orga Partner
          Voltship). Choisis le client, colle l’ID client et le secret (laisse-les vides pour seulement changer de client) : à l’installation, la boutique se rattache toute seule à ce client. Le bouton « Connecter ma boutique »
          utilisera automatiquement cette app pour ce domaine.
        </p>
        <form
          action={saveShopifyAppCredentialsAction}
          className="mt-4 grid gap-3 sm:grid-cols-5"
          autoComplete="off"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">Client</span>
            <select
              name="client_id"
              required
              className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
            >
              <option value="">Choisir…</option>
              {(clients ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">Domaine boutique</span>
            <input
              name="shop"
              required
              placeholder="boutique.myshopify.com"
              className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">ID client (app)</span>
            <input
              name="api_key"
              className="rounded-md border border-[var(--line)] bg-white px-3 py-2 font-mono text-xs"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">Secret client (app)</span>
            <input
              name="api_secret"
              type="password"
              autoComplete="new-password"
              className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">Nom (optionnel)</span>
            <div className="flex gap-2">
              <input
                name="label"
                placeholder="LIORA"
                className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-white px-3 py-2"
              />
              <button className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-white">
                Enregistrer
              </button>
            </div>
          </label>
        </form>
        {(apps ?? []).length > 0 ? (
          <ul className="mt-4 space-y-1 text-sm">
            {(apps ?? []).map((app) => (
              <li key={app.shopify_domain} className="flex flex-wrap gap-x-3 text-[var(--muted)]">
                <span className="font-medium text-[var(--ink,inherit)]">
                  {app.label ? `${app.label} · ` : ""}
                  {app.shopify_domain}
                </span>
                <span>
                  →{" "}
                  {(clients ?? []).find(
                    (client) => client.id === (app as { client_id?: string | null }).client_id,
                  )?.name ?? "aucun client"}
                </span>
                <span className="font-mono text-xs">{app.api_key}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">Connect shop</h2>
        <form action="/api/shopify/connect" method="get" className="mt-4 grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="from" value="admin" />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">Client</span>
            <select
              name="client_id"
              required
              className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
            >
              {(clients ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">Shop domain</span>
            <input
              name="shop"
              required
              placeholder="store.myshopify.com"
              className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
            />
          </label>
          <div className="flex items-end">
            <button className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-white">
              Connect Shopify
            </button>
          </div>
        </form>
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">Connected shops</h2>
        {(shops ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">No Shopify shops connected.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {(shops ?? []).map((shop) => (
              <li
                key={shop.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{shop.shopify_domain}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {shop.status} · Last sync{" "}
                    {shop.last_synced_at
                      ? new Date(shop.last_synced_at).toLocaleString()
                      : "never"}
                  </p>
                  {shop.sync_error ? (
                    <p className="mt-1 text-xs text-red-700">{shop.sync_error}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {shop.status === "active" ? (
                    <form action={syncShopAction.bind(null, shop.id)}>
                      <button className="cursor-pointer rounded-md border border-[var(--line)] px-3 py-1.5 hover:bg-white">
                        Sync now
                      </button>
                    </form>
                  ) : null}
                  {shop.status !== "disconnected" ? <DisconnectShopButton shopId={shop.id} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <div className="p-6">
          <h2 className="text-sm font-semibold">Import des produits</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Choisis une boutique. Les variantes sont regroupées par produit ; les produits à
            30 ventes ou plus sur 90 jours (toutes variantes confondues) sont pré-cochés.
          </p>
          <form method="get" className="mt-4 flex flex-wrap items-center gap-2">
            <select
              name="shop"
              defaultValue={selectedShopId ?? ""}
              className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
            >
              {(shopOptions ?? []).map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shopLabel(shop)}
                  {shop.status !== "active" ? ` (${shop.status})` : ""}
                </option>
              ))}
            </select>
            <button className="cursor-pointer rounded-md border border-[var(--line)] px-3 py-2 text-sm">
              Afficher
            </button>
          </form>
        </div>
        <ShopifyImportForm key={selectedShopId ?? "none"} products={importRows} />
      </section>
    </div>
  );
}
