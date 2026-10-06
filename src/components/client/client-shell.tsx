import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { BrandMark } from "@/components/brand-mark";
import { ClientNavLinks } from "@/components/client/nav-links";
import { SignOutButton } from "@/app/[locale]/(client)/dashboard/sign-out-button";
import { getAuthContext } from "@/lib/auth/context";
import { Bolt } from "@/components/ui";
import { ShopSwitcher } from "@/components/client/shop-switcher";
import { getActiveShopId, listClientShops } from "@/lib/shops/active";

export async function ClientShell({ children }: { children: ReactNode }) {
  const t = await getTranslations("dashboard");
  const ctx = await getAuthContext();
  const initials = (ctx?.email ?? "").slice(0, 2).toUpperCase() || "CL";
  const shops = ctx?.clientId ? await listClientShops(ctx.clientId) : [];
  const activeShop = ctx?.clientId && shops.length > 1 ? await getActiveShopId(ctx.clientId) : null;

  return (
    <div className="relative isolate min-h-screen bg-[var(--bg)]">
      <header className="border-b border-white/10 bg-[var(--navy)]">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5 sm:px-6">
          <BrandMark href="/dashboard" inverted compact />
          <ClientNavLinks showSettings={ctx?.role !== "staff"} />
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {shops.length > 1 ? (
              <ShopSwitcher shops={shops} active={activeShop} allLabel={t("allShops")} />
            ) : null}
            <Link
              href="/products/new"
              className="inline-flex items-center gap-2 rounded-[10px] bg-[var(--gold-bright)] px-3 py-2 text-[13px] font-bold text-[var(--navy)] transition hover:bg-[#f0bb5a] sm:px-4"
            >
              <Bolt fill="#10284A" />
              <span className="hidden sm:inline">{t("newProduct")}</span>
              <span className="sm:hidden">{t("newProductShort")}</span>
            </Link>
            {ctx?.role === "voltship_admin" ? (
              <Link
                href="/admin"
                className="hidden text-[12px] font-semibold text-white/75 hover:text-white md:inline"
              >
                Admin
              </Link>
            ) : null}
            <span
              title={ctx?.email ?? undefined}
              aria-label={ctx?.email ?? t("workspace")}
              className="grid h-9 w-9 place-items-center rounded-full border border-white/25 bg-white/12 text-[12px] font-bold text-white"
            >
              {initials}
            </span>
            <span className="hidden max-w-[180px] truncate text-[12px] text-white/75 xl:block">
              {ctx?.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1240px] px-4 pt-7 pb-20 sm:px-6">{children}</main>

      <footer className="border-t border-[var(--line)] px-6 py-5 text-center text-[13px] text-[var(--faint)]">
        {t("footer")}
      </footer>
    </div>
  );
}
