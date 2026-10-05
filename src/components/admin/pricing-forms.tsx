"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/app/actions/admin";
import {
  createRateGridAction,
  importRateGridCsvAction,
  updateClientPricingAction,
  upsertRateCellAction,
} from "@/app/actions/pricing";
import { RATE_GRID_CSV_TEMPLATE } from "@/lib/domain/rate-grid-csv";
import type { ShippingChannel } from "@/lib/domain/pricing";

const initial: ActionResult = { ok: false };
const channels: ShippingChannel[] = [
  "standard",
  "electronics_battery",
  "cosmetics",
  "liquid_perfume",
  "magnetic",
  "sensitive_other",
];

function SubmitState({
  state,
  pending,
  idle,
  saved = "Saved.",
}: {
  state: ActionResult;
  pending: boolean;
  idle: string;
  saved?: string;
}) {
  return (
    <>
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-800">{saved}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : idle}
      </button>
    </>
  );
}

export function CreateGridForm() {
  const [state, action, pending] = useActionState(createRateGridAction, initial);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4">
      <Input name="grid_version" label="Grid version" placeholder="2026-09-21.1" required />
      <Input
        name="effective_date"
        label="Effective date"
        type="date"
        defaultValue={new Date().toISOString().slice(0, 10)}
        required
      />
      <Input name="source" label="Source" defaultValue="manual" required />
      <div className="flex items-end">
        <SubmitState state={state} pending={pending} idle="Create grid" />
      </div>
    </form>
  );
}

export function RateCellForm({ versions }: { versions: string[] }) {
  const [state, action, pending] = useActionState(upsertRateCellAction, initial);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">Grid</span>
        <select
          name="grid_version"
          required
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        >
          {versions.map((version) => (
            <option key={version}>{version}</option>
          ))}
        </select>
      </label>
      <Input name="carrier" label="Carrier" placeholder="YunExpress" required />
      <Input name="destination" label="Destination" placeholder="FR" maxLength={2} required />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">Channel</span>
        <select
          name="channel"
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        >
          {channels.map((channel) => (
            <option key={channel}>{channel}</option>
          ))}
        </select>
      </label>
      <Input name="weight_min_g" label="Min weight (g)" type="number" min="0" required />
      <Input name="weight_max_g" label="Max weight (g)" type="number" min="0" required />
      <Input name="price" label="Shipping price (EUR)" type="number" min="0" step="0.0001" required />
      <Input name="delivery_range" label="Delivery range" placeholder="8–12 days" />
      <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-3">
        <SubmitState state={state} pending={pending} idle="Save rate cell" />
      </div>
    </form>
  );
}

export function RateGridCsvForm({ versions }: { versions: string[] }) {
  const [state, action, pending] = useActionState(importRateGridCsvAction, initial);

  function downloadTemplate() {
    const blob = new Blob([RATE_GRID_CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "voltship-rate-grid.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <form action={action} className="grid gap-3">
      <label className="flex max-w-xs flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">Grid</span>
        <select
          name="grid_version"
          required
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        >
          {versions.map((version) => (
            <option key={version}>{version}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">CSV file</span>
        <input
          name="csv"
          type="file"
          accept=".csv,text/csv"
          required
          className="text-sm"
        />
      </label>
      <p className="text-xs text-[var(--muted)]">
        Columns: carrier, destination, channel, weight_min_g, weight_max_g, price,
        delivery_range.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitState
          state={state}
          pending={pending}
          idle="Import rates"
          saved={state.clientId ? `Imported ${state.clientId} rates.` : "Imported."}
        />
        <button
          type="button"
          onClick={downloadTemplate}
          className="cursor-pointer rounded-md border border-[var(--line)] px-4 py-2 text-sm"
        >
          Download template
        </button>
      </div>
    </form>
  );
}

export function ClientPricingForm({
  clientId,
  commissionPct,
  handlingFee,
  logisticsDiscountPct,
}: {
  clientId: string;
  commissionPct: number;
  handlingFee: number;
  logisticsDiscountPct: number;
}) {
  const [state, action, pending] = useActionState(updateClientPricingAction, initial);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4">
      <input type="hidden" name="client_id" value={clientId} />
      <Input
        name="commission_pct"
        label="Product commission %"
        type="number"
        min="0"
        step="0.001"
        defaultValue={commissionPct}
      />
      <Input
        name="handling_fee"
        label="Handling / unit"
        type="number"
        min="0"
        step="0.0001"
        defaultValue={handlingFee}
      />
      <Input
        name="logistics_discount_pct"
        label="Shipping discount %"
        type="number"
        min="0"
        max="100"
        step="0.001"
        defaultValue={logisticsDiscountPct}
      />
      <div className="flex items-end">
        <SubmitState state={state} pending={pending} idle="Save pricing" />
      </div>
    </form>
  );
}

function Input({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <input
        {...props}
        className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
      />
    </label>
  );
}
