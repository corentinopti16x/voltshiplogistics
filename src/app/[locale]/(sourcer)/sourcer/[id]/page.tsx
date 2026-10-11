import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { redirect, Link } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPricingSettings } from "@/lib/pricing/settings";
import { getProductRequest, type ProductRow } from "@/lib/products/types";
import { ProductPhoto } from "@/components/client/product-photo";
import { SourcerShell } from "@/components/sourcer/sourcer-shell";
import { SourcingWorkForm } from "@/components/sourcer/sourcing-work-form";
import { AnnouncedPricesForm } from "@/components/sourcer/announced-prices-form";
import { calculateProductCogsMatrix, getProductMarkets } from "@/lib/pricing/server";
import { matrixViews } from "@/lib/pricing/matrix-view";
import { gridVersionDate } from "@/lib/domain/pricing";
import { parseFinancialProfile } from "@/lib/domain/economics";
import { packPieces } from "@/lib/products/extras";
import { CarrierSelector } from "@/components/client/carrier-selector";
import { CogsMatrix } from "@/components/client/cogs-matrix";

export default async function SourcerProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: "en" | "fr"; id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ locale, id }, { from }] = await Promise.all([params, searchParams]);
  const ctx = await getAuthContext();
  if (!ctx) {
    redirect({ href: "/staff/login", locale });
    return null;
  }
  if (ctx.role !== "sourcer" && ctx.role !== "voltship_admin") {
    redirect({ href: "/home", locale });
    return null;
  }

  const t = await getTranslations("sourcer.product");
  const tQueue = await getTranslations("sourcer.queue");
  const admin = createAdminClient();
  const settings = await readPricingSettings(admin);
  const [{ data: productData }, { data: work }] = await Promise.all([
    admin
      .from("products_cache")
      .select("*, clients!inner(name, code, financial_profile_json)")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("sourcing_work")
      .select(
        "factory_purchase_price, supplier_name, supplier_contact, sourcing_location, internal_notes, flagged_reason",
      )
      .eq("product_id", id)
      .maybeSingle(),
  ]);
  if (!productData) notFound();
  const product = productData as ProductRow & {
    clients: { name: string; code: string | null; financial_profile_json: unknown };
  };
  const request = getProductRequest(product);
  // Same engine and carrier choice as the client's product page: the line shown per market
  // is the one priced in the COGS (and the one ECCANG must use).
  const matrix = await calculateProductCogsMatrix(product).catch(() => null);
  const views = matrix ? matrixViews(matrix) : null;
  const tCarrier = await getTranslations("sourcer.carrier");

  return (
    <SourcerShell role={ctx.role}>
      <Link
        href={from === "todo" ? "/admin/todo" : "/sourcer"}
        className="text-sm text-[var(--muted)] hover:text-[var(--ink)]"
      >
        {from === "todo" ? t("backToTodo") : t("backToQueue")}
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <ProductPhoto
          src={product.photo_url}
          alt={product.title}
          className="h-40 w-40 rounded-2xl"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-[var(--muted)]">
            {product.clients.name} · {product.sku ?? t("noSku")}
          </p>
          <h1 className="font-display mt-1 text-3xl">{product.title}</h1>
        </div>
        <span className="rounded-full bg-[var(--card)] px-3 py-1 text-xs ring-1 ring-[var(--line)]">
          {tQueue(`statuses.${product.sourcing_status ?? "brief_received"}`)}
        </span>
      </div>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">{t("clientBrief")}</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <Item label={t("description")} value={request.description} />
          <Item label={t("targetUnitPrice")} value={request.target_unit_price} />
          <Item label={t("approxWeight")} value={request.approx_weight_g} />
          <Item label={t("currentUnitCost")} value={request.current_unit_cost} />
          <Item label={t("launchQty")} value={request.expected_launch_qty} />
          <Item label={t("destinationMarkets")} value={request.destination_markets} />
          <Item label={t("notes")} value={request.notes} />
          {request.source_url ? (
            <div>
              <dt className="text-xs text-[var(--muted)]">{t("reference")}</dt>
              <dd className="mt-1">
                <a
                  href={request.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {t("openSourceLink")}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <div className="mt-6">
        <SourcingWorkForm product={product} work={work} fxRmbPerEur={settings.fx_rmb_per_eur} />
      </div>
      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6" id="carrier">
        <h2 className="text-sm font-semibold">{tCarrier("title")}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">{tCarrier("lead")}</p>
        {!matrix || !views ? (
          <p className="mt-3 text-sm text-[var(--muted)]">{tCarrier("error")}</p>
        ) : matrix.missingReason ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            {matrix.missingReason === "grid" ? tCarrier("missingGrid") : tCarrier("missingProduct")}
          </p>
        ) : (
          <CarrierSelector productId={product.id} markets={views.carrierMarkets} canEdit staff />
        )}
      </section>

      {matrix && views ? (
        <div className="mt-6">
          <CogsMatrix
            markets={views.matrixMarkets}
            quantities={matrix.quantities}
            sellingPrice={product.selling_price}
            profile={parseFinancialProfile(product.clients.financial_profile_json)}
            gridVersion={matrix.activeGridVersion}
            gridDate={matrix.gridEffectiveDate ?? gridVersionDate(matrix.activeGridVersion)}
            ratesChanged={false}
            missingReason={matrix.missingReason}
            packPieces={packPieces(product.quote_json)}
          />
        </div>
      ) : null}

      <div className="mt-6">
        <AnnouncedPricesForm productId={product.id} quoteJson={product.quote_json} markets={getProductMarkets(product)} />
      </div>
    </SourcerShell>
  );
}

function Item({ label, value }: { label: string; value: unknown }) {
  if (value == null || value === "") return null;
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1">{String(value)}</dd>
    </div>
  );
}
