"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  previewLinePriceAction,
  saveLinePriceAction,
} from "@/app/actions/transport";
import type { ShippingChannel } from "@/lib/domain/pricing";
import {
  LINE_PRICE_MAX_TIERS,
  linePriceCostRmb,
  normalizeLinePrice,
  type LinePrice,
} from "@/lib/pricing/line-price";
import type { LinePricePreview } from "@/lib/pricing/line-price-server";
import { TRANSPORT_SAMPLE_WEIGHTS_G } from "@/lib/pricing/transport-view";

export type LinePriceDialogTarget = {
  /** null = a line that does not exist yet (the form asks for its carrier and name). */
  line: { carrier: string; lineName: string | null; maxG: number } | null;
  /** Current carrier cost at the sample weights (null where the line has none). */
  currentRmb: Array<number | null>;
  /** Tiers entered last time, when there are some. */
  stored: LinePrice | null;
};

type DraftTier = { maxG: string; perKg: string; fee: string };

function toNumber(text: string) {
  const clean = text.replace(/\s/g, "").replace(",", ".");
  return clean === "" ? Number.NaN : Number(clean);
}

function weightLabel(weightG: number) {
  return weightG >= 1000 ? `${weightG / 1000} kg` : `${weightG} g`;
}

const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm tabular-nums outline-none transition-colors placeholder:text-[var(--muted)]/60 focus:border-[var(--navy)]";

export function LinePriceDialog({
  target,
  destination,
  channel,
  placeLabel,
  carriers,
  locale,
  onClose,
  onSaved,
}: {
  target: LinePriceDialogTarget;
  destination: string;
  channel: ShippingChannel;
  /** "États-Unis · Standard" */
  placeLabel: string;
  carriers: string[];
  locale: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("admin.transportPage.price");
  const dialog = useRef<HTMLDialogElement>(null);
  const isNew = target.line == null;
  const [carrier, setCarrier] = useState(target.line?.carrier ?? "");
  const [lineName, setLineName] = useState(target.line?.lineName ?? "");
  const [tiers, setTiers] = useState<DraftTier[]>(() =>
    target.stored
      ? target.stored.tiers.map((tier) => ({
          maxG: String(tier.maxG),
          perKg: String(tier.perKgRmb),
          fee: String(tier.feeRmb),
        }))
      : [
          {
            maxG: target.line ? String(target.line.maxG) : "",
            perKg: "",
            fee: "",
          },
        ],
  );
  const [minBillable, setMinBillable] = useState(
    target.stored
      ? String(target.stored.minBillableG || "")
      : destination === "US"
        ? "50"
        : "",
  );
  const [preview, setPreview] = useState<LinePricePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const price = useMemo(() => {
    const result = normalizeLinePrice({
      tiers: tiers.map((tier) => ({
        maxG: toNumber(tier.maxG),
        perKgRmb: toNumber(tier.perKg || "0"),
        feeRmb: toNumber(tier.fee || "0"),
      })),
      minBillableG: minBillable.trim() === "" ? 0 : toNumber(minBillable),
    });
    return result;
  }, [tiers, minBillable]);

  const number = (value: number) =>
    new Intl.NumberFormat(locale === "zh" ? "zh-CN" : locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  const signed = (value: number) =>
    `${value > 0 ? "+" : value < 0 ? "−" : ""}${number(Math.abs(value))}`;

  /** Any change to the form makes the preview stale: it has to be asked again. */
  function edit(change: () => void) {
    change();
    setPreview(null);
    setError(null);
  }
  function setTier(index: number, patch: Partial<DraftTier>) {
    edit(() =>
      setTiers((current) =>
        current.map((tier, at) => (at === index ? { ...tier, ...patch } : tier)),
      ),
    );
  }

  function payload() {
    return {
      destination,
      channel,
      carrier: carrier.trim(),
      lineName: lineName.trim() || null,
      isNew,
      price: price.ok ? price.price : { tiers: [], minBillableG: 0 },
    };
  }
  function check() {
    if (isNew && !carrier.trim()) return "target";
    if (!price.ok) return price.error;
    return null;
  }
  function askPreview() {
    const problem = check();
    if (problem) return setError(problem);
    setError(null);
    startTransition(async () => {
      const result = await previewLinePriceAction(payload()).catch(() => ({
        ok: false as const,
        code: "failed" as const,
      }));
      if (result.ok) setPreview(result.preview);
      else setError(result.code);
    });
  }
  function apply() {
    startTransition(async () => {
      const result = await saveLinePriceAction(payload()).catch(() => ({
        ok: false as const,
        code: "failed" as const,
      }));
      if (result.ok) onSaved();
      else setError(result.code);
    });
  }

  const title = isNew
    ? t("titleNew")
    : t("title", {
        line: [target.line?.carrier, target.line?.lineName]
          .filter(Boolean)
          .join(" "),
      });

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      aria-labelledby="line-price-title"
      className="m-0 ml-auto h-dvh max-h-none w-full max-w-xl overflow-hidden bg-[var(--card)] p-0 text-[var(--ink)] shadow-2xl backdrop:bg-black/40"
    >
      <form
        className="flex h-full flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (preview) apply();
          else askPreview();
        }}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-6 py-5">
          <div>
            <h2 id="line-price-title" className="text-lg font-bold">
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-[var(--muted)]">{placeLabel}</p>
          </div>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            disabled={busy}
            aria-label={t("close")}
            className="-mr-2 rounded-lg px-2 py-1 text-xl leading-none text-[var(--muted)] hover:bg-[var(--line)]/50 hover:text-[var(--ink)]"
          >
            ×
          </button>
        </header>

        <div className="flex-1 space-y-7 overflow-y-auto px-6 py-6">
          {isNew ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="mb-1.5 block font-medium">{t("carrier")}</span>
                <input
                  className={fieldClass}
                  list="line-price-carriers"
                  value={carrier}
                  maxLength={40}
                  required
                  autoFocus
                  onChange={(event) => edit(() => setCarrier(event.target.value))}
                />
                <datalist id="line-price-carriers">
                  {carriers.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>
              <label className="text-sm">
                <span className="mb-1.5 block font-medium">{t("lineName")}</span>
                <input
                  className={fieldClass}
                  value={lineName}
                  maxLength={80}
                  placeholder={t("lineNamePlaceholder")}
                  onChange={(event) => edit(() => setLineName(event.target.value))}
                />
              </label>
            </div>
          ) : null}

          <section>
            <h3 className="text-sm font-semibold">{t("tariff")}</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">{t("tariffHelp")}</p>
            <div className="mt-4 grid grid-cols-[1fr_1fr_1fr_2rem] items-center gap-x-3 gap-y-2 text-sm">
              <span className="text-xs text-[var(--muted)]">{t("upTo")}</span>
              <span className="text-xs text-[var(--muted)]">{t("perKg")}</span>
              <span className="text-xs text-[var(--muted)]">{t("perParcel")}</span>
              <span />
              {tiers.map((tier, index) => (
                <div key={index} className="contents">
                  <input
                    className={fieldClass}
                    inputMode="numeric"
                    aria-label={t("upToLabel", { n: index + 1 })}
                    value={tier.maxG}
                    onChange={(event) => setTier(index, { maxG: event.target.value })}
                  />
                  <input
                    className={fieldClass}
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={t("perKgLabel", { n: index + 1 })}
                    value={tier.perKg}
                    autoFocus={!isNew && index === 0}
                    onChange={(event) => setTier(index, { perKg: event.target.value })}
                  />
                  <input
                    className={fieldClass}
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={t("perParcelLabel", { n: index + 1 })}
                    value={tier.fee}
                    onChange={(event) => setTier(index, { fee: event.target.value })}
                  />
                  {tiers.length > 1 ? (
                    <button
                      type="button"
                      aria-label={t("removeTier", { n: index + 1 })}
                      onClick={() =>
                        edit(() =>
                          setTiers((current) => current.filter((_, at) => at !== index)),
                        )
                      }
                      className="rounded-md py-1 text-lg leading-none text-[var(--muted)] hover:bg-[var(--line)]/50 hover:text-[var(--rust-ink)]"
                    >
                      ×
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              {tiers.length < LINE_PRICE_MAX_TIERS ? (
                <button
                  type="button"
                  onClick={() =>
                    edit(() =>
                      setTiers((current) => [...current, { maxG: "", perKg: "", fee: "" }]),
                    )
                  }
                  className="text-sm font-semibold text-[var(--navy)] hover:underline"
                >
                  {t("addTier")}
                </button>
              ) : (
                <span />
              )}
              <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
                {t("minBillable")}
                <input
                  className={`${fieldClass} !w-20 text-right`}
                  inputMode="numeric"
                  placeholder="0"
                  value={minBillable}
                  onChange={(event) => edit(() => setMinBillable(event.target.value))}
                />
                g
              </label>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold">{t("parcelCost")}</h3>
            <table className="mt-3 w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)]">
                  <th className="py-1.5 font-normal">{t("weight")}</th>
                  <th className="py-1.5 text-right font-normal">{t("current")}</th>
                  <th className="py-1.5 text-right font-normal">{t("next")}</th>
                  <th className="w-24 py-1.5 text-right font-normal">{t("change")}</th>
                </tr>
              </thead>
              <tbody>
                {TRANSPORT_SAMPLE_WEIGHTS_G.map((weightG, index) => {
                  const before = target.currentRmb[index] ?? null;
                  const raw = price.ok ? linePriceCostRmb(price.price, weightG) : null;
                  const after = raw == null ? null : Math.round(raw * 100) / 100;
                  const delta = before != null && after != null ? after - before : null;
                  return (
                    <tr key={weightG} className="border-t border-[var(--line)]">
                      <td className="py-2">{weightLabel(weightG)}</td>
                      <td className="py-2 text-right text-[var(--muted)]">
                        {before == null ? "—" : `${number(before)} ¥`}
                      </td>
                      <td className="py-2 text-right font-semibold">
                        {after == null ? "—" : `${number(after)} ¥`}
                      </td>
                      <td
                        className={`py-2 text-right ${
                          delta == null || Math.abs(delta) < 0.005
                            ? "text-[var(--muted)]"
                            : delta > 0
                              ? "text-[var(--rust-ink)]"
                              : "text-emerald-700"
                        }`}
                      >
                        {delta == null
                          ? ""
                          : Math.abs(delta) < 0.005
                            ? "="
                            : signed(delta)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {preview ? (
            <section aria-live="polite">
              <h3 className="text-sm font-semibold">{t("products")}</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {preview.pending
                  ? t("pendingLine")
                  : preview.changed === 0
                    ? t("noProduct", { checked: preview.checked })
                    : t("productCount", {
                        count: preview.changed,
                        checked: preview.checked,
                      })}
              </p>
              {preview.products.length > 0 ? (
                <ul className="mt-3 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
                  {preview.products.map((product) => {
                    const delta =
                      product.before != null && product.after != null
                        ? product.after - product.before
                        : null;
                    return (
                      <li
                        key={product.id}
                        className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{product.title}</p>
                          <p className="truncate text-xs text-[var(--muted)]">
                            {[
                              product.client,
                              product.onLineBefore && !product.onLineAfter
                                ? t("leavesLine")
                                : !product.onLineBefore && product.onLineAfter
                                  ? t("joinsLine")
                                  : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <div className="shrink-0 text-right tabular-nums">
                          <p>
                            <span className="text-[var(--muted)]">
                              {product.before == null ? "—" : `${number(product.before)} €`}
                            </span>
                            <span className="mx-1.5 text-[var(--muted)]">→</span>
                            <span className="font-semibold">
                              {product.after == null ? "—" : `${number(product.after)} €`}
                            </span>
                          </p>
                          {delta != null ? (
                            <p
                              className={`text-xs ${delta > 0 ? "text-[var(--rust-ink)]" : "text-emerald-700"}`}
                            >
                              {signed(delta)} €
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {preview.changed > preview.products.length ? (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {t("more", { count: preview.changed - preview.products.length })}
                </p>
              ) : null}
            </section>
          ) : null}
        </div>

        <footer className="border-t border-[var(--line)] px-6 py-4">
          {error ? (
            <p role="alert" className="mb-3 text-sm font-medium text-[var(--rust-ink)]">
              {t(`errors.${error}`)}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--muted)]">
              {preview ? t("applyHint") : t("previewHint")}
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => dialog.current?.close()}
                disabled={busy}
                className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--muted)] hover:bg-[var(--line)]/50"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy
                  ? preview
                    ? t("applying")
                    : t("previewing")
                  : preview
                    ? t("apply")
                    : t("preview")}
              </button>
            </div>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
