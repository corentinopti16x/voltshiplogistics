import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";

export async function SiteHeader({
  signedIn,
  tone = "light",
}: {
  signedIn: boolean;
  tone?: "light" | "dark";
}) {
  const t = await getTranslations("nav");
  const dark = tone === "dark";

  return (
    <header
      className={`sticky top-0 z-40 border-b backdrop-blur-md ${
        dark
          ? "border-white/10 bg-[#132018]/70"
          : "border-[var(--line)] bg-[var(--bg)]/85"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <BrandMark inverted={dark} />
        <div className="flex items-center gap-5">
          <LanguageSwitcher tone={tone} />
          {!signedIn ? (
            <Link
              href="/signup"
              className={
                dark
                  ? "text-sm text-white/80 hover:text-white"
                  : "text-sm text-[var(--muted)] hover:text-[var(--ink)]"
              }
            >
              {t("createAccount")}
            </Link>
          ) : null}
          <Link
            href={signedIn ? "/home" : "/login"}
            className={
              dark
                ? "rounded-full bg-[#f3eee4] px-4 py-2 text-sm font-medium text-[#132018] hover:bg-white"
                : "rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--card)] hover:bg-[var(--accent-hover)]"
            }
          >
            {signedIn ? t("openDashboard") : t("signIn")}
          </Link>
        </div>
      </div>
    </header>
  );
}
