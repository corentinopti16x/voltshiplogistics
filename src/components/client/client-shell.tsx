import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { BrandMark } from "@/components/brand-mark";
import { ClientNavLinks } from "@/components/client/nav-links";
import { SignOutButton } from "@/app/[locale]/(client)/dashboard/sign-out-button";
import { getAuthContext } from "@/lib/auth/context";

export async function ClientShell({ children }: { children: ReactNode }) {
  const t = await getTranslations("dashboard");
  const ctx = await getAuthContext();

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="relative border-b border-[var(--line)] bg-[var(--card)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <BrandMark href="/dashboard" />
          <ClientNavLinks showSettings={ctx?.role !== "staff"} />
          <div className="flex items-center gap-3">
            <Link
              href="/products/new"
              className="hidden cursor-pointer rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white sm:inline-flex"
            >
              {t("newProduct")}
            </Link>
            {ctx?.role === "voltship_admin" ? (
              <Link href="/admin" className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">
                Admin
              </Link>
            ) : null}
            {ctx?.email ? (
              <span className="hidden max-w-[160px] truncate text-xs text-[var(--muted)] lg:block">
                {ctx.email}
              </span>
            ) : null}
            <span className="rounded-full bg-[#ead9a3] px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
              {t("workspace")}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
