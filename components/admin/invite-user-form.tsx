"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { inviteUserAction, type ActionResult } from "@/app/actions/admin";

const initial: ActionResult = { ok: false };

export function InviteUserForm({ clientId }: { clientId: string }) {
  const t = useTranslations("admin");
  const [state, action, pending] = useActionState(inviteUserAction, initial);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="client_id" value={clientId} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("fields.email")}</span>
        <input
          type="email"
          name="email"
          required
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("fields.role")}</span>
        <select
          name="role"
          defaultValue="owner"
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        >
          <option value="owner">{t("roles.owner")}</option>
          <option value="staff">{t("roles.staff")}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("fields.passwordOptional")}</span>
        <input
          type="text"
          name="password"
          autoComplete="new-password"
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
        />
      </label>
      {state.error ? (
        <p className="text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.password ? (
        <p className="rounded-md border border-[var(--line)] bg-[#f3eee4] px-3 py-2 text-sm">
          {t("invitePassword")}{" "}
          <code className="font-semibold">{state.password}</code>
        </p>
      ) : null}
      {state.ok && !state.password ? (
        <p className="text-sm text-[var(--accent)]">{t("inviteDone")}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? t("inviting") : t("inviteUser")}
      </button>
    </form>
  );
}
