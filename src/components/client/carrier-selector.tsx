"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { setCarrierPreferenceAction } from "@/app/actions/client";
import { setProductCarrierStaffAction } from "@/app/actions/sourcing";
import { carrierLineLabel } from "@/lib/domain/carrier-rules";
import { lineKey, type CarrierLineRef, type RateOption } from "@/lib/domain/pricing";
import type { CarrierSelectorMarket } from "@/lib/pricing/matrix-view";
import { Badge } from "@/components/ui/badge";
import { formatAmount } from "@/lib/format";

export type { CarrierSelectorMarket };

const AUTO = "__auto__";

/**
 * "Transporteur" selector per market. The dropdown lists the cheapest-first options at the
 * product's single-unit billed weight; choosing one calls setCarrierPreferenceAction and the
 * page revalidates (quote card, matrix, economics, ECCANG push all follow the preference).
 */
export function CarrierSelector({
  productId,
  markets,
  canEdit,
  staff = false,
}: {
  productId: string;
  markets: CarrierSelectorMarket[];
  canEdit: boolean;
  /** Voltship staff sheet: saves through the sourcer action (any client's product). */
  staff?: boolean;
}) {
  const t = useTranslations("products.carrier");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedMarket, setSavedMarket] = useState<string | null>(null);

  const priceSuffix = (option: RateOption) =>
    // IOSS is Voltship's own number for every EU parcel: never shown to the client.
    `${formatAmount(option.price, locale)}${option.deliveryRange ? ` · ${option.deliveryRange}` : ""}`;
  const optionLabel = (option: RateOption) => `${carrierLineLabel(option)} · ${priceSuffix(option)}`;

  const change = (market: string, value: string) => {
    setError(null);
    setSavedMarket(null);
    const selection: CarrierLineRef | null =
      value === AUTO
        ? null
        : (() => {
            const option = markets
              .find((row) => row.destination === market)
              ?.options.find((row) => lineKey(row.carrier, row.lineName) === value);
            return option ? { carrier: option.carrier, lineName: option.lineName } : null;
          })();
    startTransition(async () => {
      const result = staff
        ? await setProductCarrierStaffAction(productId, market, selection)
        : await setCarrierPreferenceAction(productId, market, selection);
      if (!result.ok) setError(result.error ?? t("error"));
      else setSavedMarket(market);
    });
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      {markets.map((market) => {
        const cheapest = market.options[0] ?? null;
        const currentKey = market.preference ? lineKey(market.preference.carrier, market.preference.lineName) : AUTO;
        const preferredOption =
          market.preference != null
            ? market.options.find((option) => lineKey(option.carrier, option.lineName) === currentKey) ?? null
            : null;
        const preferredAvailable = preferredOption != null;
        const selectId = `carrier-${market.destination}`;
        return (
          <div key={market.destination} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <label htmlFor={selectId} className="w-[48px] shrink-0 text-[14px] font-bold">
              {market.destination}
            </label>
            {market.options.length === 0 ? (
              <span className="text-[13px] text-[var(--muted)]">{t("noOption")}</span>
            ) : market.forced ? (
              <span className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-semibold">
                  {carrierLineLabel(market.preference)}
                  {preferredOption ? ` · ${priceSuffix(preferredOption)}` : ""}
                </span>
                <Badge tone="navy">{t("forced")}</Badge>
              </span>
            ) : (
              <select
                id={selectId}
                value={currentKey}
                disabled={!canEdit || pending}
                onChange={(event) => change(market.destination, event.currentTarget.value)}
                className="vs-input min-w-0 flex-1 cursor-pointer !py-1.5 text-[13px] disabled:cursor-default disabled:opacity-70"
              >
                <option value={AUTO}>
                  {cheapest
                    ? t("auto", { label: optionLabel(cheapest) })
                    : t("autoEmpty")}
                </option>
                {market.options.map((option) => (
                  <option key={lineKey(option.carrier, option.lineName)} value={lineKey(option.carrier, option.lineName)}>
                    {optionLabel(option)}
                  </option>
                ))}
                {market.preference && !preferredAvailable ? (
                  <option value={currentKey}>{t("unavailableOption", { label: carrierLineLabel(market.preference) })}</option>
                ) : null}
              </select>
            )}
            {market.selectionReason === "fallback_preferred_unavailable" ? (
              <span className="basis-full text-[12px] text-[var(--rust-ink)]">{t("fallbackHint")}</span>
            ) : market.selectionReason === "preferred" && !market.forced ? (
              <span className="basis-full text-[12px] text-[var(--muted)]">{t("preferredHint")}</span>
            ) : null}
            {savedMarket === market.destination && !pending ? (
              <span className="basis-full text-[12px] text-[var(--green-ink)]">{t("saved")}</span>
            ) : null}
          </div>
        );
      })}
      {error ? <p className="text-[12px] text-[var(--rust-ink)]">{error}</p> : null}
      <p className="text-[12px] text-[var(--muted)]">{staff ? t("staffNote") : canEdit ? t("note") : t("readOnly")}</p>
    </div>
  );
}
