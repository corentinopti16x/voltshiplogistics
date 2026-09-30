import type { ReactNode } from "react";
import { redirect } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { ClientShell } from "@/components/client/client-shell";

export default async function ClientLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const loc = locale === "fr" ? "fr" : "en";
  const ctx = await getAuthContext();

  if (!ctx) {
    redirect({ href: "/login", locale: loc });
    return null;
  }

  if (ctx.role === "voltship_admin" && !ctx.impersonating) {
    redirect({ href: "/admin", locale: loc });
    return null;
  }

  if (ctx.role === "sourcer" && !ctx.impersonating) {
    redirect({ href: "/sourcer", locale: loc });
    return null;
  }

  if (!ctx.clientId || !ctx.client) {
    redirect({ href: "/login", locale: loc });
    return null;
  }

  return (
    <div>
      {ctx.impersonating ? (
        <ImpersonationBanner clientName={ctx.client.name} />
      ) : null}
      <ClientShell>{children}</ClientShell>
    </div>
  );
}
