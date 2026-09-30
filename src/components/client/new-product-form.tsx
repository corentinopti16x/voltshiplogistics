"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { createProductAction } from "@/app/actions/client";
import type { ActionResult } from "@/app/actions/admin";

const initial: ActionResult = { ok: false };

export function NewProductForm() {
  const t = useTranslations("products");
  const router = useRouter();
  const [state, action, pending] = useActionState(createProductAction, initial);

  useEffect(() => {
    if (state.ok && state.clientId) {
      router.replace(`/products/${state.clientId}`);
    }
  }, [state, router]);

  return (
    <form action={action} encType="multipart/form-data" className="flex max-w-xl flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("form.name")}</span>
        <input
          name="title"
          required
          minLength={2}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("form.photo")}</span>
        <input
          name="photo"
          type="file"
          accept="image/*"
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("form.link")}</span>
        <input
          name="source_url"
          type="url"
          placeholder="https://..."
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("form.description")}</span>
        <textarea
          name="description"
          rows={4}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[var(--muted)]">{t("form.targetPrice")}</span>
          <input
            name="target_price"
            type="number"
            step="0.01"
            min="0"
            className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[var(--muted)]">{t("form.launchQty")}</span>
          <input
            name="launch_qty"
            type="number"
            min="1"
            className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("form.destinations")}</span>
        <input
          name="destinations"
          placeholder="FR, DE, UK"
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("form.notes")}</span>
        <textarea
          name="notes"
          rows={3}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        />
      </label>
      {state.error ? (
        <p className="text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? t("form.submitting") : t("form.submit")}
      </button>
    </form>
  );
}
