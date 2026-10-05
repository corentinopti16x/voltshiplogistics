import type { ReactNode } from "react";
import { Link } from "@/i18n/routing";
import { BrandMark } from "@/components/brand-mark";
import { AdminNavLinks } from "@/components/admin/admin-nav-links";
import { SignOutButton } from "@/app/[locale]/(client)/dashboard/sign-out-button";

export function SourcerShell({
  role,
  children,
}: {
  role: string;
  children: ReactNode;
}) {
  const isAdmin = role === "voltship_admin";

  return (
    <div className="min-h-screen">
      <header className="relative border-b border-[var(--line)] bg-[var(--card)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-6">
            <BrandMark href={isAdmin ? "/admin" : "/sourcer"} />
            {isAdmin ? (
              <AdminNavLinks />
            ) : (
              <nav className="flex items-center gap-4 text-sm">
                <Link href="/sourcer" className="font-medium">
                  Sourcing queue
                </Link>
              </nav>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-[#ead9a3] px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
              Staff
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
