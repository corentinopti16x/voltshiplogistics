"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { importLineAction } from "@/app/actions/transport";
import { useRouter } from "@/i18n/routing";
import { linePriceCostRmb } from "@/lib/pricing/line-price";
import { LINE_SHEET_COLUMNS, parseLineSheet } from "@/lib/pricing/line-sheet";
import { TRANSPORT_SAMPLE_WEIGHTS_G } from "@/lib/pricing/transport-view";

type Outcome = "created" | "updated" | "partial" | "failed";

function weightLabel(weightG: number) {
  return weightG >= 1000 ? `${weightG / 1000} kg` : `${weightG} g`;
}

/**
 * Several lines at once: paste a sheet, check what was read (cost of a parcel per line),
 * then import. Lines are written one by one, with the progress shown.
 */
export function LineSheetImport({
  channelLabels,
  locale,
}: {
  channelLabels: Record<string, string>;
  locale: string;
}) {
  const t = useTranslations("admin.transportPage.sheet");
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  const parsed = useMemo(() => parseLineSheet(text), [text]);
  const done = Object.keys(outcomes).length;
  const finished = done > 0 && done === parsed.entries.length && !running;

  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
  }, [open]);

  const number = (value: number) =>
    new Intl.NumberFormat(locale === "zh" ? "zh-CN" : locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);

  async function run() {
    setRunning(true);
    setOutcomes({});
    for (const [index, entry] of parsed.entries.entries()) {
      const result = await importLineAction(entry).catch(() => ({
        ok: false as const,
        code: "failed" as const,
      }));
      const outcome: Outcome = !result.ok
        ? "failed"
        : !result.settingsSaved
          ? "partial"
          : result.created
            ? "created"
            : "updated";
      setOutcomes((current) => ({ ...current, [index]: outcome }));
    }
    setRunning(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap text-[var(--navy)] ring-1 ring-[var(--line)] transition-colors hover:ring-[var(--navy)]"
      >
        {t("open")}
      </button>
      {open ? (
        <dialog
          ref={dialog}
          onClose={() => {
            setOpen(false);
            setOutcomes({});
          }}
          onCancel={(event) => {
            if (running) event.preventDefault();
          }}
          aria-labelledby="line-sheet-title"
          className="m-auto max-h-[90dvh] w-full max-w-4xl overflow-hidden rounded-2xl bg-[var(--card)] p-0 text-[var(--ink)] shadow-2xl backdrop:bg-black/40"
        >
          <div className="flex max-h-[90dvh] flex-col">
            <header className="border-b border-[var(--line)] px-6 py-5">
              <h2 id="line-sheet-title" className="text-lg font-bold">
                {t("title")}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{t("help")}</p>
              <p className="mt-2 overflow-x-auto rounded-lg bg-[var(--line)]/40 px-3 py-2 font-mono text-xs whitespace-nowrap">
                {LINE_SHEET_COLUMNS.join(" · ")}
              </p>
            </header>
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <textarea
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setOutcomes({});
                }}
                disabled={running}
                rows={6}
                aria-label={t("paste")}
                placeholder={t("paste")}
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--navy)]"
              />
              {parsed.problems.length > 0 ? (
                <ul className="rounded-xl bg-[var(--rust-soft)] px-4 py-3 text-sm text-[var(--rust-ink)]">
                  {parsed.problems.map((problem) => (
                    <li key={`${problem.row}-${problem.code}`}>
                      {t("row", { row: problem.row })} :{" "}
                      {t(`problems.${problem.code}`)}
                    </li>
                  ))}
                </ul>
              ) : null}
              {parsed.entries.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--muted)]">
                      <th className="py-2 font-medium">{t("line")}</th>
                      {TRANSPORT_SAMPLE_WEIGHTS_G.map((weight) => (
                        <th key={weight} className="px-2 py-2 text-right font-medium">
                          {weightLabel(weight)}
                        </th>
                      ))}
                      <th className="py-2 pl-3 font-medium">{t("result")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.entries.map((entry, index) => {
                      const outcome = outcomes[index];
                      return (
                        <tr
                          key={`${entry.destination}|${entry.channel}|${entry.carrier}|${entry.lineName ?? ""}`}
                          className="border-t border-[var(--line)] align-top"
                        >
                          <td className="py-2.5">
                            <span className="font-bold">{entry.carrier}</span>
                            {entry.lineName ? (
                              <span className="ml-2 font-medium">{entry.lineName}</span>
                            ) : null}
                            <p className="text-xs text-[var(--muted)]">
                              {[
                                entry.destination,
                                channelLabels[entry.channel] ?? entry.channel,
                                entry.status ? t(`status.${entry.status}`) : null,
                                entry.eccangMethod,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </td>
                          {TRANSPORT_SAMPLE_WEIGHTS_G.map((weight) => {
                            const cost = linePriceCostRmb(entry.price, weight);
                            return (
                              <td key={weight} className="px-2 py-2.5 text-right tabular-nums">
                                {cost == null ? "—" : number(cost)}
                              </td>
                            );
                          })}
                          <td
                            className={`py-2.5 pl-3 text-xs font-semibold ${
                              outcome === "failed"
                                ? "text-[var(--rust-ink)]"
                                : outcome === "partial"
                                  ? "text-[#8a5a00]"
                                  : "text-emerald-700"
                            }`}
                          >
                            {outcome ? t(`outcome.${outcome}`) : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
            </div>
            <footer className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-6 py-4">
              <p className="text-xs text-[var(--muted)]" aria-live="polite">
                {running || finished
                  ? t("progress", { done, total: parsed.entries.length })
                  : t("hint")}
              </p>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={running}
                  onClick={() => dialog.current?.close()}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--muted)] hover:bg-[var(--line)]/50"
                >
                  {finished ? t("close") : t("cancel")}
                </button>
                {finished ? null : (
                  <button
                    type="button"
                    disabled={running || parsed.entries.length === 0}
                    onClick={run}
                    className="rounded-lg bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {running
                      ? t("running")
                      : t("import", { count: parsed.entries.length })}
                  </button>
                )}
              </div>
            </footer>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
