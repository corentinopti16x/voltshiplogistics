import { getTranslations } from "next-intl/server";
import { ProposalBuilder } from "@/components/sourcer/proposal-builder";
import { SourcerShell } from "@/components/sourcer/sourcer-shell";
import { Link, redirect } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { loadTransportOverview } from "@/lib/pricing/transport-server";

export const dynamic = "force-dynamic";

/**
 * Team page (sourcer + admin): price proposal for a prospect who has no account yet.
 * Products typed here are priced with the active grid and printed as a PDF; nothing is saved.
 */
export default async function ProposalPage({ params }: { params: Promise<{ locale: string }> }) {
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
  const t = await getTranslations("sourcer.proposal");
  const overview = await loadTransportOverview(null, null, { withClientPrices: false });
  const countries = overview.destinations.map((item) => item.code);
  return (
    <SourcerShell role={ctx.role}>
      <Link href="/sourcer" className="text-sm text-[var(--muted)] hover:underline">
        {t("back")}
      </Link>
      <h1 className="font-display mt-3 text-3xl">{t("title")}</h1>
      <p className="mt-2 mb-6 max-w-2xl text-sm text-[var(--muted)]">{t("lead")}</p>
      <ProposalBuilder countries={countries} />
    </SourcerShell>
  );
}
