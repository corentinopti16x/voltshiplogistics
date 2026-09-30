import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { hasVoltshipAdmin } from "@/app/actions/signup";
import { SignupForm } from "./signup-form";

export default async function SignupPage() {
  const t = await getTranslations();
  const configured = isSupabaseConfigured();
  let firstAdmin = true;

  if (configured) {
    try {
      firstAdmin = !(await hasVoltshipAdmin());
    } catch {
      firstAdmin = true;
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_480px]">
      <aside className="relative hidden flex-col justify-between bg-[var(--accent)] px-12 py-10 text-[var(--card)] lg:flex">
        <BrandMark inverted />
        <div>
          <p className="text-[11px] font-semibold tracking-[0.22em] text-[var(--gold)] uppercase">
            {t("auth.asideKicker")}
          </p>
          <p className="font-display mt-4 max-w-sm text-4xl leading-tight whitespace-pre-line">
            {t("auth.signupAside")}
          </p>
        </div>
        <p className="text-sm text-white/70">{t("app.tagline")}</p>
      </aside>

      <main className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-sm text-[var(--muted)] hover:text-[var(--ink)]"
          >
            ← {t("nav.backHome")}
          </Link>
          <LanguageSwitcher />
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <div className="mb-8 lg:hidden">
            <BrandMark />
          </div>
          <h1 className="font-display text-4xl tracking-tight">{t("auth.signupTitle")}</h1>
          <p className="mt-2 mb-8 text-sm text-[var(--muted)]">
            {firstAdmin ? t("auth.signupLeadFirst") : t("auth.signupLead")}
          </p>
          <SignupForm configured={configured} firstAdmin={firstAdmin} />
        </div>
      </main>
    </div>
  );
}
