import { getTranslations } from "next-intl/server";
import { BrandMark } from "@/components/brand-mark";
import { SignOutButton } from "@/app/[locale]/(client)/dashboard/sign-out-button";
import { AdminNavLinks } from "@/components/admin/admin-nav-links";
import { countRequiredTodo } from "@/lib/products/todo";
import { LanguageSwitcher } from "@/components/language-switcher";

export async function AdminShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const [t, todoCount] = await Promise.all([getTranslations("admin"), countRequiredTodo()]);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="relative border-b border-[var(--line)] bg-[var(--card)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-6">
            <BrandMark href="/admin" />
            <AdminNavLinks todoCount={todoCount} />
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher withChinese />
            <span className="hidden text-xs text-[var(--muted)] sm:block">{email}</span>
            <span className="rounded-full bg-[#ead9a3] px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
              {t("nav.admin")}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
