"use client";

import { useActionState } from "react";
import { updateLifecycleThresholdsAction, type ActionResult } from "@/app/actions/admin";
import type { LifecycleThresholds } from "@/lib/domain/lifecycle";

const initial: ActionResult = { ok: false };

export function LifecycleThresholdForm({
  clientId,
  thresholds,
}: {
  clientId: string;
  thresholds: LifecycleThresholds;
}) {
  const [state, action, pending] = useActionState(updateLifecycleThresholdsAction, initial);
  const fields = [
    ["testing_max_age_days", "Testing max age (days)", thresholds.testingMaxAgeDays, 1, 365],
    [
      "winning_min_orders_per_day_14d",
      "Winning orders / day (14 days)",
      thresholds.winningMinOrdersPerDay14d,
      0,
      1000,
    ],
    [
      "declining_sales_drop_pct",
      "Declining drop %",
      thresholds.decliningSalesDropPct,
      1,
      100,
    ],
    ["dead_no_sales_days", "Dead after days without sales", thresholds.deadNoSalesDays, 1, 365],
  ] as const;

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="client_id" value={clientId} />
      {fields.map(([name, label, value, min, max]) => (
        <label key={name} className="flex flex-col gap-1.5 text-sm">
          <span className="text-[var(--muted)]">{label}</span>
          <input
            name={name}
            type="number"
            min={min}
            max={max}
            step="1"
            defaultValue={value}
            className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
          />
        </label>
      ))}
      {state.error ? <p className="text-sm text-red-700 sm:col-span-2">{state.error}</p> : null}
      {state.ok ? (
        <p className="text-sm text-emerald-800 sm:col-span-2">Lifecycle rules saved.</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save lifecycle rules"}
      </button>
    </form>
  );
}
