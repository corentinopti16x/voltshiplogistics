import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createAdminClient } from "@/lib/supabase/admin";
import { InviteUserForm } from "@/components/admin/invite-user-form";
import { PlanTierForm } from "@/components/admin/plan-tier-form";
import { ImpersonateButton } from "@/components/admin/impersonate-button";
import { ClientPricingForm } from "@/components/admin/pricing-forms";
import { LifecycleThresholdForm } from "@/components/admin/lifecycle-threshold-form";
import { parseLifecycleThresholds } from "@/lib/domain/lifecycle";
import type { Client, Profile } from "@/lib/auth/types";

type ClientWithPricing = Client & {
  commission_pct: number | null;
  handling_fee: number | null;
  logistics_discount_pct: number | null;
  lifecycle_thresholds_json: unknown;
};

export default async function AdminClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("admin");
  const admin = createAdminClient();

  const { data: client } = await admin
    .from("clients")
    .select(
      "id, name, code, language, plan_tier, timezone, created_at, commission_pct, handling_fee, logistics_discount_pct, lifecycle_thresholds_json",
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

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <h2 className="text-sm font-semibold">{t("usersTitle")}</h2>
          <ul className="mt-4 divide-y divide-[var(--line)]">
            {(users ?? []).length === 0 ? (
              <li className="py-3 text-sm text-[var(--muted)]">{t("noUsers")}</li>
            ) : (
              (users ?? []).map((user) => (
                <li key={user.id} className="flex items-center justify-between py-3 text-sm">
                  <span>{user.email}</span>
                  <span className="capitalize text-[var(--muted)]">{user.role}</span>
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
