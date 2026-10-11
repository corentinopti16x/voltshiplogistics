import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { activateRateGridFormAction, savePackagingWeightAction } from "@/app/actions/pricing";
import { ButtonLink } from "@/components/ui/button";
import { CreateGridForm, RateCellForm, RateGridCsvForm } from "@/components/admin/pricing-forms";
import { readPricingSettings } from "@/lib/pricing/settings";
import { ConfidentialTag } from "@/components/admin/margin-ui";
import type { ShippingChannel } from "@/lib/domain/pricing";

const CHANNELS = new Set<string>([
  "standard",
  "electronics_battery",
  "cosmetics",
  "liquid_perfume",
  "magnetic",
  "sensitive_other",
] satisfies ShippingChannel[]);

export default async function AdminPricingPage() {
  const t = await getTranslations("admin.rateImport");
  const tc = await getTranslations("admin.pricingCells");
  const tp = await getTranslations("admin.pricingPage");
  const tf = await getTranslations("admin.pricingForms");
  const admin = createAdminClient();
  const [{ data: grids }, { data: cells }, { data: active }, settings] = await Promise.all([
    admin
      .from("rate_grids")
      .select("grid_version, effective_date, source, created_at")
      .order("created_at", { ascending: false }),
    admin
      .from("rate_grid_cells")
      .select(
        // carrier_cost_rmb is INTERNAL: this page is rendered for voltship_admin only.
        "id, grid_version, carrier, destination, channel, weight_min_g, weight_max_g, price, delivery_range, line_name, tax_included, carrier_cost_rmb",
      )
      .order("grid_version", { ascending: false })
      .order("destination"),
    admin
      .from("pricing_meta")
      .select("value")
      .eq("key", "active_grid_version")
      .maybeSingle(),
    readPricingSettings(admin),
  ]);
  const versions = (grids ?? []).map((grid) => grid.grid_version);
  const hasCarrierCost = (cells ?? []).some((cell) => cell.carrier_cost_rmb != null);
  const eur = (value: number) => `${value.toFixed(2)} €`;

  return (
    <div>
      <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">
        {tp("kicker")}
      </p>
      <h1 className="font-display mt-2 text-3xl">{tp("title")}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">{tp("lead")}</p>
      <div className="mt-4">
        <ButtonLink href="/admin/pricing/update" variant="gold">
          ✦ {t("linkFromPricing")}
        </ButtonLink>
      </div>

      <section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6" id="packaging">
        <h2 className="text-sm font-semibold">{tp("packagingTitle")}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{tp("packagingLead")}</p>
        <form action={savePackagingWeightAction} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">{tp("packagingLabel")}</span>
            <span className="flex items-stretch overflow-hidden rounded-md border border-[var(--line)] bg-white">
              <input
                name="packaging_weight_g"
                type="number"
                min="0"
                max="2000"
                step="1"
                defaultValue={settings.packaging_weight_g}
                className="tabular w-28 px-3 py-2 outline-none"
              />
              <span className="flex items-center border-l border-[var(--line)] bg-[var(--card-soft)] px-2.5 text-xs font-semibold text-[var(--muted)]">
                g
              </span>
            </span>
          </label>
          <button
            type="submit"
            className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          >
            {tp("packagingSave")}
          </button>
        </form>
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">{tp("newGrid")}</h2>
        <div className="mt-4">
          <CreateGridForm />
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">{tp("versions")}</h2>
        {versions.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">{tp("noVersions")}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {(grids ?? []).map((grid) => {
              const isActive = active?.value === grid.grid_version;
              return (
                <li
                  key={grid.grid_version}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{grid.grid_version}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {grid.effective_date} · {grid.source}
                    </p>
                  </div>
                  {isActive ? (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-900">
                      {tp("active")}
                    </span>
                  ) : (
                    <form action={activateRateGridFormAction}>
                      <input type="hidden" name="grid_version" value={grid.grid_version} />
                      <button
                        type="submit"
                        className="cursor-pointer rounded-md border border-[var(--line)] px-3 py-1.5 hover:bg-white"
                      >
                        {tp("activate")}
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {versions.length > 0 ? (
        <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <h2 className="text-sm font-semibold">{tp("importTitle")}</h2>
          <p className="mt-1 mb-4 text-sm text-[var(--muted)]">{tp("importLead")}</p>
          <RateGridCsvForm versions={versions} />
        </section>
      ) : null}

      {versions.length > 0 ? (
        <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <h2 className="text-sm font-semibold">{tp("addRateTitle")}</h2>
          <div className="mt-4">
            <RateCellForm versions={versions} />
          </div>
        </section>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <div className="flex flex-wrap items-center gap-3 p-6">
          <h2 className="text-sm font-semibold">{tp("cellsTitle")}</h2>
          {hasCarrierCost ? <ConfidentialTag /> : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-y border-[var(--line)] text-xs text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">{tp("columns.version")}</th>
                <th className="px-4 py-3">{tp("columns.carrier")}</th>
                <th className="px-4 py-3">{tp("columns.line")}</th>
                <th className="px-4 py-3">{tp("columns.destination")}</th>
                <th className="px-4 py-3">{tp("columns.channel")}</th>
                <th className="px-4 py-3">{tp("columns.weight")}</th>
                <th className="px-4 py-3">{tp("columns.price")}</th>
                {hasCarrierCost ? (
                  <>
                    <th className="px-4 py-3">{tc("carrierCost")}</th>
                    <th className="px-4 py-3">{tc("transportMargin")}</th>
                  </>
                ) : null}
                <th className="px-4 py-3">{tp("columns.delivery")}</th>
              </tr>
            </thead>
            <tbody>
              {(cells ?? []).map((cell) => (
                <tr key={cell.id} className="border-b border-[var(--line)]">
                  <td className="px-4 py-3">{cell.grid_version}</td>
                  <td className="px-4 py-3">{cell.carrier}</td>
                  <td className="px-4 py-3">
                    {cell.line_name ?? "—"}
                    {cell.tax_included === false ? (
                      <span className="ml-1 text-[var(--rust-ink)]" title={tp("taxNotIncluded")}>
                        ⚠
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{cell.destination}</td>
                  <td className="px-4 py-3">
                    {CHANNELS.has(cell.channel)
                      ? tf(`channels.${cell.channel as ShippingChannel}`)
                      : cell.channel.replaceAll("_", " ")}
                  </td>
                  <td className="px-4 py-3">
                    {cell.weight_min_g}–{cell.weight_max_g}g
                  </td>
                  <td className="tabular px-4 py-3">{Number(cell.price).toFixed(2)} €</td>
                  {hasCarrierCost ? (
                    <CarrierCostCells
                      price={Number(cell.price)}
                      carrierCostRmb={cell.carrier_cost_rmb == null ? null : Number(cell.carrier_cost_rmb)}
                      taxIncluded={cell.tax_included !== false}
                      fx={settings.fx_rmb_per_eur}
                      tax={settings.eu_parcel_tax_eur}
                      eur={eur}
                      taxNote={tc("taxNote", { tax: eur(settings.eu_parcel_tax_eur) })}
                    />
                  ) : null}
                  <td className="px-4 py-3">{cell.delivery_range ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Internal columns (admin only): carrier cost RMB → € and the transport margin of the cell. */
function CarrierCostCells({
  price,
  carrierCostRmb,
  taxIncluded,
  fx,
  tax,
  eur,
  taxNote,
}: {
  price: number;
  carrierCostRmb: number | null;
  taxIncluded: boolean;
  fx: number;
  tax: number;
  eur: (value: number) => string;
  taxNote: string;
}) {
  if (carrierCostRmb == null) {
    return (
      <>
        <td className="px-4 py-3 text-[var(--faint)]">—</td>
        <td className="px-4 py-3 text-[var(--faint)]">—</td>
      </>
    );
  }
  const costEur = carrierCostRmb / fx;
  const passThrough = taxIncluded ? 0 : tax;
  const margin = price - costEur - passThrough;
  return (
    <>
      <td className="tabular px-4 py-3">
        {carrierCostRmb.toFixed(2)} RMB → {eur(costEur)}
      </td>
      <td className={`tabular px-4 py-3 ${margin < 0 ? "text-[var(--rust-ink)]" : "text-[var(--green-ink)]"}`}>
        {eur(margin)}
        {passThrough > 0 ? <span className="ml-1 text-[11px] text-[var(--faint)]">({taxNote})</span> : null}
      </td>
    </>
  );
}
