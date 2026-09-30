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

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
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

  if (ctx?.clientId) {
    try {
      const admin = createAdminClient();
      const userId = ctx.impersonatedUserId ?? ctx.userId;
      const [{ data }, { data: saved }] = await Promise.all([
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
      ]);
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

  return (
    <div>
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="mt-2 mb-8 text-sm text-[var(--muted)]">{t("lead")}</p>
      <SettingsForm
        profile={profile}
        safetyBufferDays={safetyBufferDays}
        coverageTargetDays={coverageTargetDays}
      />
      <NotificationPreferencesForm preferences={preferences} />
    </div>
  );
}
