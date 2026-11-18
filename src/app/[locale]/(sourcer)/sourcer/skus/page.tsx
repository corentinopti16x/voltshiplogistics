import { getLocale } from "next-intl/server";
import { SkuFixView, type SkuFixQuery } from "@/components/sourcer/sku-fix-view";
import { SourcerShell } from "@/components/sourcer/sourcer-shell";
import { redirect } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Team access to « SKU à corriger »: write the SKU in Shopify, then push the product to ECCANG. */
export default async function TeamSkuFixPage({ searchParams }: { searchParams: Promise<SkuFixQuery> }) {
  const [query, loc, ctx] = await Promise.all([searchParams, getLocale(), getAuthContext()]);
  if (!ctx) {
    redirect({ href: "/staff/login", locale: loc });
    return null;
  }
  if (ctx.role !== "sourcer" && ctx.role !== "voltship_admin") {
    redirect({ href: "/home", locale: loc });
    return null;
  }
  return (
    <SourcerShell role={ctx.role}>
      <SkuFixView query={query} base="/sourcer/skus" />
    </SourcerShell>
  );
}
