"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { updatePlanTierAction, type ActionResult } from "@/app/actions/admin";
import { PLAN_TIERS, type PlanTier } from "@/lib/auth/types";

const initial: ActionResult = { ok: false };

export function PlanTierForm({
  clientId,
  current,
}: {
  clientId: string;
  current: PlanTier;
}) {
  const t = useTranslations("admin");
  const [state, action, pending] = useActionState(updatePlanTierAction, initial);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="client_id" value={clientId} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("fields.plan")}</span>
        <select
          name="plan_tier"
          defaultValue={current}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 capitalize"
        >
          {PLAN_TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {tier}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-[var(--line)] px-4 py-2 text-sm hover:bg-white disabled:opacity-60"
      >
        {pending ? t("saving") : t("savePlan")}
      </button>
      {state.error ? (
        <p className="w-full text-sm text-red-700">{state.error}</p>
      ) : null}
      {state.ok ? (
        <p className="text-sm text-[var(--accent)]">{t("planSaved")}</p>
      ) : null}
    </form>
  );
}
