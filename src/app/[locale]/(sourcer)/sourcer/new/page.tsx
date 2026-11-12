import { getTranslations } from "next-intl/server";
import { SourcerShell } from "@/components/sourcer/sourcer-shell";
import { TeamNewProductForm } from "@/components/sourcer/team-new-product-form";
import { Link, redirect } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Team page (sourcer + admin): open a product request for a client who asked by message. */
export default async function TeamNewProductPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ctx = await getAuthContext();
  if (!ctx) {
    redirect({ href: "/staff/login", locale });
    return null;
  }
  if (ctx.role !== "sourcer" && ctx.role !== "voltship_admin") {
    redirect({ href: "/home", locale });
    return null;
  }
  const t = await getTranslations("sourcer.newProduct");
  const { data } = await createAdminClient().from("clients").select("id, name").order("name");
  const clients = (data ?? []) as Array<{ id: string; name: string }>;
  return (
    <SourcerShell role={ctx.role}>
      <Link href="/sourcer" className="text-sm text-[var(--muted)] hover:underline">
        {t("back")}
      </Link>
      <h1 className="font-display mt-3 text-3xl">{t("title")}</h1>
      <p className="mt-2 mb-6 max-w-xl text-sm text-[var(--muted)]">{t("lead")}</p>
      <TeamNewProductForm clients={clients} />
    </SourcerShell>
  );
}
