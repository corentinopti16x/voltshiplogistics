"use client";

import { useActionState } from "react";
import { useRouter } from "@/i18n/routing";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { createClientAction, type ActionResult } from "@/app/actions/admin";
import { PLAN_TIERS } from "@/lib/auth/types";

const initial: ActionResult = { ok: false };

export function CreateClientForm() {
  const t = useTranslations("admin");
  const router = useRouter();
  const [state, action, pending] = useActionState(createClientAction, initial);

  useEffect(() => {
    if (state.ok && state.clientId) {
      router.replace(`/admin/clients/${state.clientId}`);
    }
  }, [state, router]);

  return (
    <form action={action} className="flex max-w-lg flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("fields.name")}</span>
        <input
          name="name"
          required
          minLength={2}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("fields.code")}</span>
        <input
          name="code"
          placeholder={t("fields.codeHint")}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[var(--muted)]">{t("fields.language")}</span>
          <select
            name="language"
            defaultValue="en"
            className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
          >
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[var(--muted)]">{t("fields.plan")}</span>
          <select
            name="plan_tier"
            defaultValue="bronze"
            className="rounded-md border border-[var(--line)] bg-white px-3 py-2 capitalize"
          >
            {PLAN_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("fields.timezone")}</span>
        <input
          name="timezone"
          defaultValue="Europe/Paris"
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
        {pending ? t("creating") : t("createClient")}
      </button>
    </form>
  );
}
