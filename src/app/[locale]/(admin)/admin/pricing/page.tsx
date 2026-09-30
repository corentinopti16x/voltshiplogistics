import { createAdminClient } from "@/lib/supabase/admin";
import { activateRateGridFormAction } from "@/app/actions/pricing";
import { CreateGridForm, RateCellForm, RateGridCsvForm } from "@/components/admin/pricing-forms";

export default async function AdminPricingPage() {
  const admin = createAdminClient();
  const [{ data: grids }, { data: cells }, { data: active }] = await Promise.all([
    admin
      .from("rate_grids")
      .select("grid_version, effective_date, source, created_at")
      .order("created_at", { ascending: false }),
    admin
      .from("rate_grid_cells")
      .select(
        "id, grid_version, carrier, destination, channel, weight_min_g, weight_max_g, price, delivery_range",
      )
      .order("grid_version", { ascending: false })
      .order("destination"),
    admin
      .from("pricing_meta")
      .select("value")
      .eq("key", "active_grid_version")
      .maybeSingle(),
  ]);
  const versions = (grids ?? []).map((grid) => grid.grid_version);

  return (
    <div>
      <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">
        Voltship admin
      </p>
      <h1 className="font-display mt-2 text-3xl">Pricing service</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Versioned shipping rates. Activating a version updates live COGS; accepted quotes stay
        frozen.
      </p>

      <section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">New grid version</h2>
        <div className="mt-4">
          <CreateGridForm />
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">Versions</h2>
        {versions.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">Create a grid before adding rates.</p>
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
                      Active
                    </span>
                  ) : (
                    <form action={activateRateGridFormAction}>
                      <input type="hidden" name="grid_version" value={grid.grid_version} />
                      <button
                        type="submit"
                        className="cursor-pointer rounded-md border border-[var(--line)] px-3 py-1.5 hover:bg-white"
                      >
                        Activate
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
          <h2 className="text-sm font-semibold">Import a rate sheet</h2>
          <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
            Upload every weight bracket for one grid version. Matching cells are updated.
          </p>
          <RateGridCsvForm versions={versions} />
        </section>
      ) : null}

      {versions.length > 0 ? (
        <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <h2 className="text-sm font-semibold">Add or update a rate</h2>
          <div className="mt-4">
            <RateCellForm versions={versions} />
          </div>
        </section>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <div className="p-6">
          <h2 className="text-sm font-semibold">Rate cells</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-y border-[var(--line)] text-xs text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Carrier</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Weight</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Delivery</th>
              </tr>
            </thead>
            <tbody>
              {(cells ?? []).map((cell) => (
                <tr key={cell.id} className="border-b border-[var(--line)]">
                  <td className="px-4 py-3">{cell.grid_version}</td>
                  <td className="px-4 py-3">{cell.carrier}</td>
                  <td className="px-4 py-3">{cell.destination}</td>
                  <td className="px-4 py-3">{cell.channel.replaceAll("_", " ")}</td>
                  <td className="px-4 py-3">
                    {cell.weight_min_g}–{cell.weight_max_g}g
                  </td>
                  <td className="px-4 py-3">${Number(cell.price).toFixed(2)}</td>
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
