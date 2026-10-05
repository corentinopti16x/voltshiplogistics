import { redirect } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";

// Home router checks auth context at runtime to direct users to their dashboard/admin/sourcer
export const dynamic = "force-dynamic";

export default async function HomeRouter({
  params,
}: {
  params: Promise<{ locale: "en" | "fr" }>;
}) {
  const { locale } = await params;
  const ctx = await getAuthContext();

  if (!ctx) {
    redirect({ href: "/login", locale });
    return null;
  }

  const destLocale =
    ctx.client?.language === "fr" || ctx.client?.language === "en"
      ? ctx.client.language
      : locale;

  if (ctx.role === "voltship_admin" && !ctx.impersonating) {
    redirect({ href: "/admin", locale: destLocale });
  }

  if (ctx.role === "sourcer" && !ctx.impersonating) {
    redirect({ href: "/sourcer", locale: destLocale });
  }

  if (!ctx.clientId) {
    redirect({ href: "/login", locale: destLocale });
  }

  redirect({ href: "/dashboard", locale: destLocale });
}
