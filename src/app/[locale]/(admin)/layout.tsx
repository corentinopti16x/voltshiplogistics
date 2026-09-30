import type { ReactNode } from "react";
import { redirect } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function AdminLayout({
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
    redirect({ href: "/staff/login", locale: loc });
    return null;
  }

  if (ctx.role !== "voltship_admin") {
    redirect({ href: "/home", locale: loc });
    return null;
  }

  return <AdminShell email={ctx.email}>{children}</AdminShell>;
}
