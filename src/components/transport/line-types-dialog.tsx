"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { setLineChannelsAction } from "@/app/actions/transport";
import type { ShippingChannel } from "@/lib/domain/pricing";
import { shortLineName } from "@/lib/pricing/line-price";
import { TRANSPORT_CHANNELS } from "@/lib/pricing/transport-view";

/**
 * Product types a line accepts in this country. A ticked type that the line did not have
 * gets the prices of the type shown on the page; an unticked one is removed from the grid.
 */
export function LineTypesDialog({
  destination,
  carrier,
  lineName,
  current,
  copyFrom,
  channelLabels,
  onClose,
  onSaved,
}: {
  destination: string;
  carrier: string;
  lineName: string | null;
  current: ShippingChannel[];
  copyFrom: ShippingChannel;
  channelLabels: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("admin.transportPage.types");
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<ShippingChannel[]>(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  const add = selected.filter((item) => !current.includes(item));
  const remove = current.filter((item) => !selected.includes(item));
  const names = (list: ShippingChannel[]) =>
    list.map((item) => channelLabels[item] ?? item).join(", ");

  function save() {
    startTransition(async () => {
      const result = await setLineChannelsAction({
        destination,
        carrier,
        lineName,
        add,
        remove,
        copyFrom,
      }).catch(() => ({ ok: false as const, code: "failed" as const }));
      if (result.ok) onSaved();
      else setError(result.code);
    });
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      aria-labelledby="line-types-title"
      className="m-auto w-full max-w-md rounded-2xl bg-[var(--card)] p-0 text-[var(--ink)] shadow-2xl backdrop:bg-black/40"
    >
      <div className="px-6 py-5">
        <h2 id="line-types-title" className="text-lg font-bold">
          {t("title", {
            line: `${carrier} ${shortLineName(carrier, lineName)}`.trim(),
          })}
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("help")}</p>
        <div className="mt-4 space-y-1">
          {TRANSPORT_CHANNELS.map((item) => (
            <label
              key={item}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-[var(--line)]/40"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--navy)]"
                checked={selected.includes(item)}
                disabled={busy}
                onChange={(event) =>
                  setSelected((list) =>
                    event.target.checked
                      ? [...list, item]
                      : list.filter((other) => other !== item),
                  )
                }
              />
              {channelLabels[item] ?? item}
            </label>
          ))}
        </div>
        <div className="mt-4 min-h-10 space-y-1 text-sm" aria-live="polite">
          {add.length > 0 ? (
            <p className="text-emerald-700">
              {t("willAdd", {
                list: names(add),
                from: channelLabels[copyFrom] ?? copyFrom,
              })}
            </p>
          ) : null}
          {remove.length > 0 ? (
            <p className="font-medium text-[var(--rust-ink)]">
              {selected.length === 0
                ? t("willRemoveLine")
                : t("willRemove", { list: names(remove) })}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="font-medium text-[var(--rust-ink)]">
              {t("failed")}
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => dialog.current?.close()}
            className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--muted)] hover:bg-[var(--line)]/50"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={busy || (add.length === 0 && remove.length === 0)}
            onClick={save}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 ${
              remove.length > 0 ? "bg-[var(--rust-ink)]" : "bg-[var(--navy)]"
            }`}
          >
            {busy
              ? t("saving")
              : remove.length > 0
                ? t("confirmRemove")
                : t("save")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
