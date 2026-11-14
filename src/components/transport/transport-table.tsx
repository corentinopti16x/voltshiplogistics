"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { saveLineSettingAction } from "@/app/actions/transport";
import { useRouter } from "@/i18n/routing";
import type { ShippingChannel } from "@/lib/domain/pricing";
import { shortLineName, type LinePrice } from "@/lib/pricing/line-price";
import {
  TRANSPORT_SAMPLE_WEIGHTS_G,
  type TransportLine,
} from "@/lib/pricing/transport-view";
import { LineTypesDialog } from "./line-types-dialog";
import {
  LinePriceDialog,
  type LinePriceDialogTarget,
} from "./line-price-dialog";

type Field = "status" | "eccangMethod" | "deliveryDays" | "note";
type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "error"; code: string };

function weightLabel(weightG: number) {
  return weightG >= 1000 ? `${weightG / 1000} kg` : `${weightG} g`;
}

/**
 * A text that turns into an input on focus. Saves on blur or Enter when the value changed,
 * Escape puts the previous value back.
 */
function InlineText({
  value,
  placeholder,
  label,
  disabled,
  className = "",
  onCommit,
}: {
  value: string;
  placeholder: string;
  label: string;
  disabled: boolean;
  className?: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }
  const cancelled = useRef(false);
  return (
    <input
      type="text"
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={600}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelled.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        const next = draft.replace(/\s+/g, " ").trim();
        if (next !== value) onCommit(next);
        else setDraft(value);
      }}
      className={`w-full rounded-md border border-transparent bg-transparent px-2 py-1 transition-colors outline-none placeholder:text-[var(--muted)]/60 hover:border-[var(--line)] focus:border-[var(--navy)] focus:bg-[var(--card)] disabled:cursor-not-allowed disabled:hover:border-transparent ${className}`}
    />
  );
}

export function TransportTable({
  destination,
  channel,
  placeLabel,
  lines: initialLines,
  storedPrices,
  channelLabels,
  canEdit,
  locale,
}: {
  destination: string;
  channel: ShippingChannel;
  /** "États-Unis · Standard", shown in the price panel. */
  placeLabel: string;
  lines: TransportLine[];
  /** Tiers last entered for each line (by line key), to pre-fill the price panel. */
  storedPrices: Record<string, LinePrice>;
  channelLabels: Record<string, string>;
  /** Status, ECCANG line, delivery time and note need migration 00025; prices do not. */
  canEdit: boolean;
  locale: string;
}) {
  const t = useTranslations("admin.transportPage");
  const router = useRouter();
  const [lines, setLines] = useState(initialLines);
  const [source, setSource] = useState(initialLines);
  if (source !== initialLines) {
    setSource(initialLines);
    setLines(initialLines);
  }
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [pricing, setPricing] = useState<LinePriceDialogTarget | null>(null);
  const [typing, setTyping] = useState<TransportLine | null>(null);
  const carriers = [
    ...new Set([
      ...lines.map((line) => line.carrier),
      "YunExpress",
      "Tongyou",
      "Huahan",
      "4PX",
    ]),
  ];
  const timeNow = () =>
    new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
  const [, startTransition] = useTransition();
  const number = (value: number) =>
    new Intl.NumberFormat(locale === "zh" ? "zh-CN" : locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);

  function commit(line: TransportLine, field: Field, value: string | null) {
    const previous = lines;
    const patch: Partial<TransportLine> =
      field === "status"
        ? { status: value === "pending" ? "pending" : "active" }
        : field === "eccangMethod"
          ? { eccangMethod: value }
          : field === "deliveryDays"
            ? { deliveryRange: value }
            : { note: value };
    setLines((current) =>
      current.map((item) =>
        item.key === line.key ? { ...item, ...patch } : item,
      ),
    );
    setSave({ kind: "saving" });
    startTransition(async () => {
      const result = await saveLineSettingAction({
        destination,
        carrier: line.carrier,
        lineName: line.lineName,
        field,
        value,
      }).catch(() => ({ ok: false as const, code: "failed" as const }));
      if (!result.ok) {
        setLines(previous);
        setSave({ kind: "error", code: result.code });
        return;
      }
      setSave({ kind: "saved", at: timeNow() });
      // Order, « cheapest » marks and fallbacks are computed on the server.
      router.refresh();
    });
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
      <div className="flex min-h-11 items-center justify-between gap-4 border-b border-[var(--line)] px-5 py-2.5 text-xs">
        <span className="text-[var(--muted)]">
          {canEdit ? t("editHint") : t("readOnly")}
        </span>
        <span className="flex items-center gap-4">
        <span
          role="status"
          aria-live="polite"
          className={
            save.kind === "error"
              ? "font-semibold text-[var(--rust-ink)]"
              : save.kind === "saved"
                ? "font-semibold text-emerald-700"
                : "text-[var(--muted)]"
          }
        >
          {save.kind === "saving"
            ? t("saving")
            : save.kind === "saved"
              ? t("saved", { time: save.at })
              : save.kind === "error"
                ? t(`errors.${save.code}`)
                : ""}
        </span>
          <button
            type="button"
            onClick={() =>
              setPricing({ line: null, currentRmb: [], stored: null })
            }
            className="rounded-lg bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-white transition-opacity hover:opacity-90"
          >
            {t("price.addLine")}
          </button>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--muted)]">
              <th className="px-5 py-3 font-medium">{t("table.line")}</th>
              {TRANSPORT_SAMPLE_WEIGHTS_G.map((weight) => (
                <th key={weight} className="px-2 py-3 text-right font-medium">
                  {weightLabel(weight)}
                </th>
              ))}
              <th className="px-2 py-3" />
              <th className="w-28 px-2 py-3 text-right font-medium">
                {t("table.delivery")}
              </th>
              <th className="w-40 px-2 py-3 font-medium">
                {t("table.eccang")}
              </th>
              <th className="w-32 px-5 py-3 font-medium">
                {t("table.status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td
                  colSpan={TRANSPORT_SAMPLE_WEIGHTS_G.length + 5}
                  className="px-5 py-8 text-[var(--muted)]"
                >
                  {t("empty")}
                </td>
              </tr>
            ) : null}
            {lines.map((line) => {
              const pending = line.status === "pending";
              return (
                <tr
                  key={line.key}
                  className="border-t border-[var(--line)] align-top"
                >
                  <td className="px-5 py-4">
                    <p className={pending ? "opacity-60" : ""}>
                      <span className="text-base font-bold">
                        {line.carrier}
                      </span>
                      {line.lineName ? (
                        <span className="ml-2 font-medium">
                          {shortLineName(line.carrier, line.lineName)}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {t("accepts", {
                        list: line.channels
                          .map((item) => channelLabels[item] ?? item)
                          .join(", "),
                      })}
                      {line.iossRequired ? ` · ${t("ioss")}` : ""}
                      <button
                        type="button"
                        onClick={() => setTyping(line)}
                        className="ml-2 font-semibold text-[var(--navy)] hover:underline"
                      >
                        {t("types.edit")}
                      </button>
                    </p>
                    <div className="mt-1.5 -ml-2">
                      <InlineText
                        value={line.note ?? ""}
                        placeholder={t("notePlaceholder")}
                        label={t("noteLabel", {
                          line: `${line.carrier} ${shortLineName(line.carrier, line.lineName)}`,
                        })}
                        disabled={!canEdit}
                        className="text-[13px]"
                        onCommit={(next) => commit(line, "note", next || null)}
                      />
                    </div>
                  </td>
                  {line.samples.map((sample) => (
                    <td
                      key={sample.weightG}
                      className="px-2 py-4 text-right tabular-nums"
                    >
                      {sample.costRmb == null ? (
                        <span className="text-[var(--muted)]/50">—</span>
                      ) : (
                        <span
                          className={
                            sample.cheapest
                              ? "rounded-md bg-emerald-50 px-2 py-1 font-bold text-emerald-700"
                              : pending
                                ? "px-2 py-1 text-[var(--muted)]"
                                : "px-2 py-1"
                          }
                        >
                          {number(sample.costRmb)}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-3.5">
                    <button
                      type="button"
                      onClick={() =>
                        setPricing({
                          line: {
                            carrier: line.carrier,
                            lineName: line.lineName,
                            maxG: line.maxG,
                          },
                          currentRmb: line.samples.map(
                            (sample) => sample.costRmb,
                          ),
                          stored: storedPrices[line.key] ?? null,
                        })
                      }
                      aria-label={t("price.editLabel", {
                        line: `${line.carrier} ${shortLineName(line.carrier, line.lineName)}`,
                      })}
                      className="rounded-md px-2 py-1 text-xs font-semibold whitespace-nowrap text-[var(--navy)] ring-1 ring-[var(--line)] transition-colors hover:bg-[var(--navy)] hover:text-white hover:ring-[var(--navy)]"
                    >
                      {t("price.edit")}
                    </button>
                  </td>
                  <td className="px-2 py-3">
                    <InlineText
                      value={line.deliveryRange ?? ""}
                      placeholder={t("deliveryPlaceholder")}
                      label={t("deliveryLabel", {
                        line: `${line.carrier} ${shortLineName(line.carrier, line.lineName)}`,
                      })}
                      disabled={!canEdit}
                      className="text-right"
                      onCommit={(next) =>
                        commit(line, "deliveryDays", next || null)
                      }
                    />
                  </td>
                  <td className="px-2 py-3">
                    <InlineText
                      value={line.eccangMethod ?? ""}
                      placeholder={t("notLinked")}
                      label={t("eccangLabel", {
                        line: `${line.carrier} ${shortLineName(line.carrier, line.lineName)}`,
                      })}
                      disabled={!canEdit}
                      className={
                        line.eccangMethod
                          ? "font-semibold text-emerald-700"
                          : "placeholder:!text-[var(--rust-ink)]"
                      }
                      onCommit={(next) =>
                        commit(line, "eccangMethod", next || null)
                      }
                    />
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!pending}
                      aria-label={t("statusLabel", {
                        line: `${line.carrier} ${shortLineName(line.carrier, line.lineName)}`,
                      })}
                      disabled={!canEdit}
                      onClick={() =>
                        commit(line, "status", pending ? "active" : "pending")
                      }
                      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--navy)] disabled:cursor-not-allowed ${
                        pending
                          ? "bg-[var(--gold-soft)] text-[#8a5a00] hover:bg-[#f6e3b8]"
                          : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      }`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${pending ? "bg-[var(--gold)]" : "bg-emerald-500"}`}
                      />
                      {pending ? t("status.pending") : t("status.active")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {typing ? (
        <LineTypesDialog
          key={typing.key}
          destination={destination}
          carrier={typing.carrier}
          lineName={typing.lineName}
          current={typing.channels}
          copyFrom={channel}
          channelLabels={channelLabels}
          onClose={() => setTyping(null)}
          onSaved={() => {
            setTyping(null);
            setSave({ kind: "saved", at: timeNow() });
            router.refresh();
          }}
        />
      ) : null}
      {pricing ? (
        <LinePriceDialog
          key={pricing.line ? `${pricing.line.carrier}|${pricing.line.lineName ?? ""}` : "new"}
          target={pricing}
          destination={destination}
          channel={channel}
          placeLabel={placeLabel}
          carriers={carriers}
          locale={locale}
          onClose={() => setPricing(null)}
          onSaved={() => {
            setPricing(null);
            setSave({ kind: "saved", at: timeNow() });
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
