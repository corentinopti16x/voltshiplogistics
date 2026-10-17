import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TrackingImportForm, type TrackingClientOption } from "@/components/admin/tracking-import-form";

export const dynamic = "force-dynamic";
// Each server call sends ≤ 20 orders (≈ 40 Shopify requests).
export const maxDuration = 120;

/**
 * « Suivis → Shopify »: imports a tracking file (ours, ECCANG, carrier or previous agent) and
 * marks the orders as shipped in the client's Shopify stores, with the tracking number.
 */
export default async function AdminTrackingPage() {
  const t = await getTranslations("admin.trackingPage");
  const admin = createAdminClient();
  const { data: shops } = await admin
    .from("shops")
    .select("id, client_id, shopify_domain, status, clients!inner(name)")
    .eq("status", "active")
    .not("access_token_encrypted", "is", null)
    .order("shopify_domain");
  const byClient = new Map<string, TrackingClientOption>();
  for (const shop of shops ?? []) {
    const clientRow = Array.isArray(shop.clients) ? shop.clients[0] : shop.clients;
    const name = (clientRow as { name?: string } | null)?.name ?? "?";
    const option: TrackingClientOption = byClient.get(shop.client_id) ?? { id: shop.client_id, name, shops: [] };
    option.shops.push({ id: String(shop.id), domain: String(shop.shopify_domain) });
    byClient.set(shop.client_id, option);
  }
  const clients = [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">{t("kicker")}</p>
        <h1 className="font-display mt-2 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">{t("lead")}</p>
      </div>
      <TrackingImportForm clients={clients} />
    </div>
  );
}
