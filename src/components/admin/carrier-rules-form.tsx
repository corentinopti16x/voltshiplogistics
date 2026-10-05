"use client";

import { useActionState } from "react";
import { updateCarrierRulesAction, type ActionResult } from "@/app/actions/admin";
import { lineKey, type CarrierLineRef } from "@/lib/domain/pricing";
import { carrierLineLabel, type CarrierRules } from "@/lib/domain/carrier-rules";

const initial: ActionResult = { ok: false };

export type GridLine = CarrierLineRef & {
  /** Markets (ISO2) the line serves in the active grid. */
  markets: string[];
};

/**
 * Admin "Transporteurs" card of a client: one "Autorisée" checkbox per line of the active
 * grid (unchecked → blocked for every COGS computation and ECCANG push of this client) and
 * an optional forced line per market (overrides the client's own choice).
 */
export function CarrierRulesForm({
  clientId,
  lines,
  markets,
  rules,
}: {
  clientId: string;
  lines: GridLine[];
  markets: string[];
  rules: CarrierRules;
}) {
  const [state, action, pending] = useActionState(updateCarrierRulesAction, initial);
  const blocked = new Set(rules.blocked);

  if (lines.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No active grid — activate a rate grid first.</p>;
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="client_id" value={clientId} />
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-[var(--muted)]">
            <th className="pb-2 font-medium">Line</th>
            <th className="pb-2 font-medium">Markets</th>
            <th className="pb-2 text-right font-medium">Autorisée</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const key = lineKey(line.carrier, line.lineName);
            return (
              <tr key={key} className="border-t border-[var(--line)]">
                <td className="py-2 font-medium">
                  {carrierLineLabel(line)}
                  <input type="hidden" name="lines" value={key} />
                </td>
                <td className="py-2 text-[var(--muted)]">{line.markets.join(", ")}</td>
                <td className="py-2 text-right">
                  <input
                    type="checkbox"
                    name="allowed"
                    value={key}
                    defaultChecked={!blocked.has(key)}
                    aria-label={`Allow ${carrierLineLabel(line)}`}
                    className="h-4 w-4 cursor-pointer"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div>
        <h3 className="text-xs font-semibold text-[var(--muted)]">Forced line per market (optional)</h3>
        <p className="mt-1 mb-3 text-xs text-[var(--muted)]">
          Replaces the client’s choice on that market. Falls back to the cheapest allowed line when the
          forced line has no bracket at the parcel weight.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {markets.map((market) => {
            const current = rules.forced[market];
            const options = lines.filter((line) => line.markets.includes(market));
            return (
              <label key={market} className="flex items-center gap-3 text-sm">
                <span className="w-10 font-semibold">{market}</span>
                <select
                  name={`forced:${market}`}
                  defaultValue={current ? lineKey(current.carrier, current.lineName) : ""}
                  className="flex-1 rounded-md border border-[var(--line)] bg-white px-3 py-2"
                >
                  <option value="">Client choice (cheapest by default)</option>
                  {options.map((line) => {
                    const key = lineKey(line.carrier, line.lineName);
                    return (
                      <option key={key} value={key}>
                        {carrierLineLabel(line)}
                      </option>
                    );
                  })}
                </select>
              </label>
            );
          })}
        </div>
      </div>

      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-800">Carrier rules saved.</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save carrier rules"}
      </button>
    </form>
  );
}
