import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_FINANCIAL_PROFILE,
  parseFinancialProfile,
} from "@/lib/domain/economics";
import { SettingsForm } from "@/components/client/settings-form";
import {
  NotificationPreferencesForm,
  type PreferenceRow,
} from "@/components/client/notification-preferences-form";
import { isNotificationEvent } from "@/lib/notifications/events";
import { ShopifyShopsCard, type ShopRow } from "@/components/client/shopify-shops-card";
import { ApiKeysCard } from "@/components/client/api-keys-card";
import { GmailMailboxCard } from "@/components/client/gmail-mailbox-card";
import { isGmailConfigured } from "@/lib/support/gmail";
import { getMailbox, listApiKeys, type ApiKeyRow, type MailboxSummary } from "@/lib/support/queries";
import { Card, PageTitle, SectionTitle } from "@/components/ui";

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ connected?: string; error?: string; gmail_connected?: string; gmail_error?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const loc = locale === "fr" ? "fr" : "en";
  const t = await getTranslations("settings");
  const ctx = await getAuthContext();

  if (ctx?.role === "staff") {
    redirect({ href: "/dashboard", locale: loc });
  }

  let profile = DEFAULT_FINANCIAL_PROFILE;
  let safetyBufferDays = 7;
  let coverageTargetDays = 60;
  let preferences: PreferenceRow[] = [];
  let shops: ShopRow[] = [];
  let apiKeys: ApiKeyRow[] = [];
  let mailbox: MailboxSummary | null = null;

  if (ctx?.clientId) {
    try {
      const admin = createAdminClient();
      const userId = ctx.impersonatedUserId ?? ctx.userId;
      const [{ data }, { data: saved }, { data: shopRows }, keyRows, mailboxRow] = await Promise.all([
        admin
          .from("clients")
          .select("financial_profile_json, safety_buffer_days, coverage_target_days")
          .eq("id", ctx.clientId)
          .maybeSingle(),
        admin
          .from("notification_preferences")
          .select("event_type, in_app, email, whatsapp")
          .eq("client_id", ctx.clientId)
          .eq("user_id", userId),
        admin
          .from("shops")
          .select("id, shopify_domain, status, last_synced_at, sync_error")
          .eq("client_id", ctx.clientId)
          .order("created_at", { ascending: false }),
        listApiKeys(ctx.clientId).catch(() => [] as ApiKeyRow[]),
        getMailbox(ctx.clientId).catch(() => null),
      ]);
      shops = (shopRows ?? []) as ShopRow[];
      apiKeys = keyRows;
      mailbox = mailboxRow;
      profile = parseFinancialProfile(data?.financial_profile_json);
      safetyBufferDays = data?.safety_buffer_days ?? 7;
      coverageTargetDays = data?.coverage_target_days ?? 60;
      preferences = (saved ?? []).flatMap((row) =>
        isNotificationEvent(row.event_type)
          ? [{ ...row, event_type: row.event_type }]
          : [],
      );
    } catch {
      profile = DEFAULT_FINANCIAL_PROFILE;
    }
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.voltshiplogistics.com").replace(/\/$/, "");

  return (
    <div className="flex flex-col gap-5">
      <PageTitle bandClass="h-[250px]" title={t("title")} lead={t("lead")} />
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <Card as="section" padding="md">
          <SectionTitle sub={t("financialLead")}>{t("financialTitle")}</SectionTitle>
          <div className="mt-4">
            <SettingsForm
              profile={profile}
              safetyBufferDays={safetyBufferDays}
              coverageTargetDays={coverageTargetDays}
            />
          </div>
        </Card>
        <Card as="section" padding="md">
          <NotificationPreferencesForm preferences={preferences} />
        </Card>
        <Card as="section" padding="md" className="lg:col-span-2">
          <ShopifyShopsCard
            shops={shops}
            canConnect={ctx?.role !== "staff"}
            connected={query.connected === "1"}
            error={query.error ?? null}
          />
        </Card>
        <Card as="section" padding="md">
          <GmailMailboxCard
            mailbox={mailbox}
            canConnect={ctx?.role !== "staff"}
            configured={isGmailConfigured()}
            connected={query.gmail_connected === "1"}
            error={query.gmail_error ?? null}
          />
        </Card>
        <Card as="section" padding="md">
          <ApiKeysCard keys={apiKeys} canManage={ctx?.role !== "staff"} endpoint={`${appUrl}/api/public/v1`} />
        </Card>
      </div>
    </div>
  );
}
