import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default async function StaffResetPasswordPage() {
  const t = await getTranslations();
  const configured = isSupabaseConfigured();

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_480px]">
      <aside className="relative hidden flex-col justify-between bg-[#132018] px-12 py-10 text-[var(--card)] lg:flex">
        <BrandMark inverted href="/staff/login" />
        <div>
          <p className="text-[11px] font-semibold tracking-[0.22em] text-[var(--gold)] uppercase">
            {t("auth.staffKicker")}
          </p>
          <p className="font-display mt-4 max-w-sm text-4xl leading-tight whitespace-pre-line">
            {t("auth.staffAsideTitle")}
          </p>
        </div>
        <p className="text-sm text-white/70">{t("auth.staffAsideLead")}</p>
      </aside>

      <main className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
            ← {t("nav.backHome")}
          </Link>
          <LanguageSwitcher />
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <div className="mb-8 lg:hidden">
            <BrandMark href="/staff/login" />
          </div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">
            {t("auth.staffKicker")}
          </p>
          <h1 className="font-display mt-2 text-4xl tracking-tight">{t("auth.resetTitle")}</h1>
          <p className="mt-2 mb-8 text-sm text-[var(--muted)]">{t("auth.resetLead")}</p>
          <ResetPasswordForm configured={configured} />
        </div>
      </main>
    </div>
  );
}
