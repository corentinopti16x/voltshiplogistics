import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createAdminClient } from "@/lib/supabase/admin";
import { InviteUserForm } from "@/components/admin/invite-user-form";
import { SendResetButton } from "@/components/admin/send-reset-button";
import { PlanTierForm } from "@/components/admin/plan-tier-form";
import { ImpersonateButton } from "@/components/admin/impersonate-button";
import { ClientPricingForm } from "@/components/admin/pricing-forms";
import { LifecycleThresholdForm } from "@/components/admin/lifecycle-threshold-form";
import { CarrierRulesForm, type GridLine } from "@/components/admin/carrier-rules-form";
import { parseCarrierRules } from "@/lib/domain/carrier-rules";
import { lineKey } from "@/lib/domain/pricing";
import { parseLifecycleThresholds } from "@/lib/domain/lifecycle";
import { EccangCard } from "@/components/admin/eccang-card";
import { isEccangConfigured } from "@/lib/eccang/client";
import { getShippingMethodMap } from "@/lib/eccang/sync";
import { getActiveGridVersion } from "@/lib/pricing/server";
import { shippingMethodKey } from "@/lib/eccang/mapping";
import { getAuthContext } from "@/lib/auth/context";
import { loadClientMargin } from "@/lib/pricing/margin-server";
import { ClientMarginCard } from "@/components/admin/client-margin-card";
import type { Client, Profile } from "@/lib/auth/types";
import { supportSummary } from "@/lib/support/queries";

type ClientWithPricing = Client & {
  commission_pct: number | null;
  handling_fee: number | null;
  logistics_discount_pct: number | null;
  lifecycle_thresholds_json: unknown;
  carrier_rules_json: unknown;
  eccang_app_key: string | null;
  eccang_app_token_encrypted: string | null;
  eccang_warehouse_code: string | null;
  eccang_enabled: boolean | null;
  eccang_last_sync_at: string | null;
  eccang_sync_error: string | null;
};

export default async function AdminClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [t, ctx] = await Promise.all([getTranslations("admin"), getAuthContext()]);
  const admin = createAdminClient();
  // Confidential margin card: voltship_admin only (the layout already redirects others).
  const isVoltshipAdmin = ctx?.role === "voltship_admin" && !ctx.impersonating;

  const { data: client } = await admin
    .from("clients")
    .select(
      "id, name, code, language, plan_tier, timezone, created_at, commission_pct, handling_fee, logistics_discount_pct, lifecycle_thresholds_json, carrier_rules_json, eccang_app_key, eccang_app_token_encrypted, eccang_warehouse_code, eccang_enabled, eccang_last_sync_at, eccang_sync_error",
    )
    .eq("id", id)
    .maybeSingle<ClientWithPricing>();

  if (!client) notFound();

  const { data: users } = await admin
    .from("profiles")
    .select("id, email, role, created_at, last_login_at, client_id")
    .eq("client_id", id)
    .order("created_at", { ascending: true })
    .returns<Profile[]>();

  // ECCANG card data: global shipping map, carrier keys of the active grid, per-client counters.
  const activeGrid = await getActiveGridVersion().catch(() => null);
  const [shippingMap, gridCells, productsResult, pushedResult, ordersResult, inboundResult, clientMargin] =
    await Promise.all([
      getShippingMethodMap().catch(() => ({})),
      activeGrid
        ? admin.from("rate_grid_cells").select("carrier, line_name, destination").eq("grid_version", activeGrid)
        : Promise.resolve({ data: [] as Array<{ carrier: string; line_name: string | null; destination: string }> }),
      admin
        .from("products_cache")
        .select("id", { count: "exact", head: true })
        .eq("client_id", id)
        .in("sourcing_status", ["validated", "in_production", "in_stock"]),
      admin
        .from("products_cache")
        .select("id", { count: "exact", head: true })
        .eq("client_id", id)
        .not("quote_json->_eccang->>pushed_at", "is", null),
      admin.from("eccang_orders").select("id", { count: "exact", head: true }).eq("client_id", id),
      admin.from("inbound_cache").select("id", { count: "exact", head: true }).eq("client_id", id),
      isVoltshipAdmin ? loadClientMargin(id).catch(() => null) : Promise.resolve(null),
    ]);
  const support = await supportSummary(id).catch(() => ({ mailbox: null, openTickets: 0 }));
  const carrierKeys = [
    ...new Set(
      (gridCells.data ?? []).flatMap((cell) => [
        shippingMethodKey(cell.carrier),
        ...(cell.line_name ? [shippingMethodKey(cell.carrier, cell.line_name)] : []),
      ]),
    ),
  ].sort();
  // Carrier rules card: every line of the active grid with the markets it serves.
  const gridLines = new Map<string, GridLine>();
  for (const cell of gridCells.data ?? []) {
    const key = lineKey(cell.carrier, cell.line_name || null);
    const market = cell.destination.trim().toUpperCase();
    const line: GridLine =
      gridLines.get(key) ?? { carrier: cell.carrier, lineName: cell.line_name || null, markets: [] };
    if (!line.markets.includes(market)) line.markets.push(market);
    gridLines.set(key, line);
  }
  const carrierLines = [...gridLines.values()]
    .map((line) => ({ ...line, markets: line.markets.sort() }))
    .sort((a, b) => lineKey(a.carrier, a.lineName).localeCompare(lineKey(b.carrier, b.lineName)));
  const gridMarkets = [...new Set(carrierLines.flatMap((line) => line.markets))].sort();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.voltshiplogistics.com").replace(/\/$/, "");
  // Shown to voltship_admin only (server-rendered): this is what gets pasted into the ECCANG OMS.
  const callbackUrl = `${appUrl}/api/webhooks/eccang?token=${
    process.env.ECCANG_WEBHOOK_SECRET ?? "<définir ECCANG_WEBHOOK_SECRET>"
  }`;

  return (
    <div>
      <Link
        href="/admin/clients"
        className="text-sm text-[var(--muted)] hover:text-[var(--ink)]"
      >
        ← {t("back")}
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">{client.name}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {client.code} · {client.language.toUpperCase()} · {client.timezone}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {t("support.line", {
              mailbox: support.mailbox
                ? t("support.connected", { email: support.mailbox.email_address })
                : t("support.notConnected"),
              count: support.openTickets,
            })}
          </p>
        </div>
        <ImpersonateButton clientId={client.id} />
      </div>

      <section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">{t("planTitle")}</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--muted)]">{t("planHelp")}</p>
        <PlanTierForm clientId={client.id} current={client.plan_tier} />
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">Client pricing</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
          These values are applied to the active shipping grid on every live COGS calculation.
        </p>
        <ClientPricingForm
          clientId={client.id}
          commissionPct={Number(client.commission_pct) || 0}
          handlingFee={Number(client.handling_fee) || 0}
          logisticsDiscountPct={Number(client.logistics_discount_pct) || 0}
        />
      </section>

      {clientMargin ? <ClientMarginCard data={clientMargin} /> : null}

      <section id="lifecycle" className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">Lifecycle rules</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
          These thresholds classify this client’s products on the next Shopify sync.
        </p>
        <LifecycleThresholdForm
          clientId={client.id}
          thresholds={parseLifecycleThresholds(client.lifecycle_thresholds_json)}
        />
      </section>

      <section id="carriers" className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">Carrier lines</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
          Lines this client may pick per product and market (unchecked = hidden and never used), plus an
          optional forced line per market. Applied to every live COGS and to ECCANG order pushes; accepted
          quotes stay frozen.
        </p>
        <CarrierRulesForm
          clientId={client.id}
          lines={carrierLines}
          markets={gridMarkets}
          rules={parseCarrierRules(client.carrier_rules_json)}
        />
      </section>

      <EccangCard
        clientId={client.id}
        configured={isEccangConfigured()}
        enabled={Boolean(client.eccang_enabled)}
        appKey={client.eccang_app_key ?? ""}
        hasToken={Boolean(client.eccang_app_token_encrypted)}
        warehouseCode={client.eccang_warehouse_code ?? ""}
        lastSyncAt={client.eccang_last_sync_at}
        syncError={client.eccang_sync_error}
        carrierKeys={carrierKeys}
        shippingMap={shippingMap}
        callbackUrl={callbackUrl}
        stats={{
          products: productsResult.count ?? 0,
          pushedProducts: pushedResult.count ?? 0,
          orders: ordersResult.count ?? 0,
          inbound: inboundResult.count ?? 0,
        }}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <h2 className="text-sm font-semibold">{t("usersTitle")}</h2>
          <ul className="mt-4 divide-y divide-[var(--line)]">
            {(users ?? []).length === 0 ? (
              <li className="py-3 text-sm text-[var(--muted)]">{t("noUsers")}</li>
            ) : (
              (users ?? []).map((user) => (
                <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <span className="min-w-0 truncate">
                    {user.email}
                    <span className="ml-2 capitalize text-[var(--muted)]">{user.role}</span>
                  </span>
                  <SendResetButton userId={user.id} />
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <h2 className="text-sm font-semibold">{t("inviteTitle")}</h2>
          <p className="mt-1 mb-4 text-sm text-[var(--muted)]">{t("inviteHelp")}</p>
          <InviteUserForm clientId={client.id} />
        </section>
      </div>
    </div>
  );
}
