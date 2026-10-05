"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { createProductAction } from "@/app/actions/client";
import type { ActionResult } from "@/app/actions/admin";

const initial: ActionResult = { ok: false };

export function NewProductForm() {
  const t = useTranslations("products");
  const router = useRouter();
  const [state, action, pending] = useActionState(createProductAction, initial);
  // The alcohol sub-question only appears once "liquid" is ticked.
  const [liquid, setLiquid] = useState(false);

  useEffect(() => {
    if (state.ok && state.clientId) {
      router.replace(`/products/${state.clientId}`);
    }
  }, [state, router]);

  return (
    <form action={action} encType="multipart/form-data" className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[12px] font-semibold text-[var(--muted)]">{t("form.name")}</span>
        <input
          name="title"
          required
          minLength={2}
          className="vs-input"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[12px] font-semibold text-[var(--muted)]">{t("form.photo")}</span>
        <input
          name="photo"
          type="file"
          accept="image/*"
          className="vs-input"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[12px] font-semibold text-[var(--muted)]">{t("form.link")}</span>
        <input
          name="source_url"
          type="url"
          placeholder="https://..."
          className="vs-input"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[12px] font-semibold text-[var(--muted)]">{t("form.description")}</span>
        <textarea
          name="description"
          rows={4}
          className="vs-input"
        />
      </label>
      {/* Product nature → suggested shipping channel (lib/products/attributes) */}
      <fieldset className="flex flex-col gap-2 rounded-[12px] border border-[var(--line)] p-3.5">
        <legend className="px-1 text-[12px] font-semibold text-[var(--muted)]">{t("form.nature")}</legend>
        <p className="text-[12px] text-[var(--faint)]">{t("form.natureHint")}</p>
        <AttributeCheck name="attr_electronics" label={t("form.attrElectronics")} example={t("form.attrElectronicsEx")} />
        <AttributeCheck
          name="attr_liquid"
          label={t("form.attrLiquid")}
          example={t("form.attrLiquidEx")}
          onChange={(checked) => setLiquid(checked)}
        />
        {liquid ? (
          <div className="ml-6">
            <AttributeCheck name="attr_alcohol" label={t("form.attrAlcohol")} example={t("form.attrAlcoholEx")} />
          </div>
        ) : null}
        <AttributeCheck name="attr_ingestible" label={t("form.attrIngestible")} example={t("form.attrIngestibleEx")} />
        <AttributeCheck name="attr_magnetic" label={t("form.attrMagnetic")} example={t("form.attrMagneticEx")} />
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[12px] font-semibold text-[var(--muted)]">{t("form.approxWeight")}</span>
          <input name="approx_weight_g" type="number" min="1" step="1" inputMode="numeric" className="vs-input" />
          <span className="text-[12px] text-[var(--faint)]">{t("form.approxWeightEx")}</span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[12px] font-semibold text-[var(--muted)]">{t("form.currentUnitCost")}</span>
          <input name="current_unit_cost" type="number" min="0" step="0.01" inputMode="decimal" className="vs-input" />
          <span className="text-[12px] text-[var(--faint)]">{t("form.currentUnitCostEx")}</span>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[12px] font-semibold text-[var(--muted)]">{t("form.targetPrice")}</span>
          <input
            name="target_price"
            type="number"
            step="0.01"
            min="0"
            className="vs-input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[12px] font-semibold text-[var(--muted)]">{t("form.launchQty")}</span>
          <input
            name="launch_qty"
            type="number"
            min="1"
            className="vs-input"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[12px] font-semibold text-[var(--muted)]">{t("form.destinations")}</span>
        <input
          name="destinations"
          placeholder="FR, DE, UK"
          className="vs-input"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[12px] font-semibold text-[var(--muted)]">{t("form.notes")}</span>
        <textarea
          name="notes"
          rows={3}
          className="vs-input"
        />
      </label>
      {state.error ? (
        <p className="text-sm text-[var(--rust-ink)]" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex cursor-pointer items-center justify-center rounded-[10px] bg-[var(--navy)] px-4 py-2.5 text-[14px] font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? t("form.submitting") : t("form.submit")}
      </button>
    </form>
  );
}

function AttributeCheck({
  name,
  label,
  example,
  onChange,
}: {
  name: string;
  label: string;
  example: string;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        name={name}
        onChange={(event) => onChange?.(event.target.checked)}
        className="mt-[3px] h-4 w-4 shrink-0 accent-[var(--navy)]"
      />
      <span className="flex flex-col">
        <span className="text-[14px] font-medium text-[var(--ink)]">{label}</span>
        <span className="text-[12px] text-[var(--faint)]">{example}</span>
      </span>
    </label>
  );
}
