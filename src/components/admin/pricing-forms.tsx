"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/app/actions/admin";
import {
  createRateGridAction,
  importRateGridCsvAction,
  updateClientPricingAction,
  upsertRateCellAction,
} from "@/app/actions/pricing";
import { RATE_GRID_CSV_TEMPLATE } from "@/lib/domain/rate-grid-csv";
import type { ShippingChannel } from "@/lib/domain/pricing";
import {
  PRICING_TIERS,
  PRICING_TIER_LABELS,
  PRICING_TIER_PRESETS,
  type PricingTier,
} from "@/lib/domain/pricing-tiers";

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
  saved,
}: {
  state: ActionResult;
  pending: boolean;
  idle: string;
  saved?: string;
}) {
  const t = useTranslations("admin.pricingForms");
  return (
    <>
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-800">{saved ?? t("saved")}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? t("saving") : idle}
      </button>
    </>
  );
}

export function CreateGridForm() {
  const t = useTranslations("admin.pricingForms");
  const [state, action, pending] = useActionState(createRateGridAction, initial);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4">
      <Input name="grid_version" label={t("grid.version")} placeholder="2026-09-21.1" required />
      <Input
        name="effective_date"
        label={t("grid.effectiveDate")}
        type="date"
        defaultValue={new Date().toISOString().slice(0, 10)}
        required
      />
      <Input name="source" label={t("grid.source")} defaultValue="manual" required />
      <div className="flex items-end">
        <SubmitState state={state} pending={pending} idle={t("grid.create")} />
      </div>
    </form>
  );
}

export function RateCellForm({ versions }: { versions: string[] }) {
  const t = useTranslations("admin.pricingForms");
  const [state, action, pending] = useActionState(upsertRateCellAction, initial);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">{t("cell.grid")}</span>
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
      <Input name="carrier" label={t("cell.carrier")} placeholder="YunExpress" required />
      <Input name="destination" label={t("cell.destination")} placeholder="FR" maxLength={2} required />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted)]">{t("cell.channel")}</span>
        <select
          name="channel"
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        >
          {channels.map((channel) => (
            <option key={channel} value={channel}>
              {t(`channels.${channel}`)}
            </option>
          ))}
        </select>
      </label>
      <Input name="weight_min_g" label={t("cell.weightMin")} type="number" min="0" required />
      <Input name="weight_max_g" label={t("cell.weightMax")} type="number" min="0" required />
      <Input name="price" label={t("cell.price")} type="number" min="0" step="0.0001" required />
      <Input name="delivery_range" label={t("cell.deliveryRange")} placeholder={t("cell.deliveryRangePlaceholder")} />
      <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-3">
        <SubmitState state={state} pending={pending} idle={t("cell.save")} />
      </div>
    </form>
  );
}

export function RateGridCsvForm({ versions }: { versions: string[] }) {
  const t = useTranslations("admin.pricingForms");
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
        <span className="text-[var(--muted)]">{t("cell.grid")}</span>
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
        <span className="text-[var(--muted)]">{t("csv.file")}</span>
        <input
          name="csv"
          type="file"
          accept=".csv,text/csv"
          required
          className="text-sm"
        />
      </label>
      <p className="text-xs text-[var(--muted)]">
        {t("csv.columns", {
          columns: "carrier, destination, channel, weight_min_g, weight_max_g, price, delivery_range",
        })}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitState
          state={state}
          pending={pending}
          idle={t("csv.import")}
          saved={state.clientId ? t("csv.importedCount", { count: state.clientId }) : t("csv.imported")}
        />
        <button
          type="button"
          onClick={downloadTemplate}
          className="cursor-pointer rounded-md border border-[var(--line)] px-4 py-2 text-sm"
        >
          {t("csv.downloadTemplate")}
        </button>
      </div>
    </form>
  );
}

export function ClientPricingForm({
  clientId,
  pricingTier,
  commissionPct,
  handlingFee,
  logisticsDiscountPct,
}: {
  clientId: string;
  pricingTier: PricingTier;
  commissionPct: number;
  handlingFee: number;
  logisticsDiscountPct: number;
}) {
  const t = useTranslations("admin.pricingForms");
  const [state, action, pending] = useActionState(updateClientPricingAction, initial);
  const [tier, setTier] = useState<PricingTier>(pricingTier);
  const [commission, setCommission] = useState(String(commissionPct));
  const [handling, setHandling] = useState(String(handlingFee));
  const [discount, setDiscount] = useState(String(logisticsDiscountPct));

  function pickTier(next: PricingTier) {
    setTier(next);
    const preset = PRICING_TIER_PRESETS[next];
    setCommission(String(preset.commissionPct));
    setHandling(String(preset.handlingFee));
    setDiscount(String(preset.logisticsDiscountPct));
  }

  const preset = PRICING_TIER_PRESETS[tier];
  const custom =
    Number(commission) !== preset.commissionPct ||
    Number(handling) !== preset.handlingFee ||
    Number(discount) !== preset.logisticsDiscountPct;

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4">
      <input type="hidden" name="client_id" value={clientId} />
      <label className="flex flex-col gap-1 text-sm sm:col-span-4 sm:max-w-xs">
        <span className="text-[var(--muted)]">{t("client.tier")}</span>
        <select
          name="pricing_tier"
          value={tier}
          onChange={(event) => pickTier(event.target.value as PricingTier)}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        >
          {PRICING_TIERS.map((value) => (
            <option key={value} value={value}>
              {PRICING_TIER_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <Input
        name="logistics_discount_pct"
        label={t("client.logisticsDiscount")}
        type="number"
        min="0"
        max="100"
        step="0.001"
        value={discount}
        onChange={(event) => setDiscount(event.target.value)}
      />
      <Input
        name="commission_pct"
        label={t("client.commission")}
        type="number"
        min="0"
        step="0.001"
        value={commission}
        onChange={(event) => setCommission(event.target.value)}
      />
      <Input
        name="handling_fee"
        label={t("client.handling")}
        type="number"
        min="0"
        step="0.0001"
        value={handling}
        onChange={(event) => setHandling(event.target.value)}
      />
      <div className="flex items-end gap-3">
        <SubmitState state={state} pending={pending} idle={t("client.save")} />
      </div>
      <p className="text-xs text-[var(--muted)] sm:col-span-4">
        {custom
          ? t("client.customHint", {
              tier: PRICING_TIER_LABELS[tier],
              discount: preset.logisticsDiscountPct,
              commission: preset.commissionPct,
              handling: preset.handlingFee,
            })
          : t("client.standardHint", { tier: PRICING_TIER_LABELS[tier] })}
      </p>
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
