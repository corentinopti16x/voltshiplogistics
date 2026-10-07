"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { SectionTitle } from "@/components/ui";

/** Lets a logged-in client choose a new password (Supabase updateUser). */
export function ChangePasswordCard() {
  const t = useTranslations("settings.password");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error" | "mismatch">("idle");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setStatus("mismatch");
      return;
    }
    setStatus("saving");
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setStatus("error");
      return;
    }
    setPassword("");
    setConfirm("");
    setStatus("saved");
  }

  const input =
    "rounded-md border border-[var(--line)] bg-white px-3 py-2 outline-none focus:border-[var(--accent)]";
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <SectionTitle sub={t("lead")}>{t("title")}</SectionTitle>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("new")}</span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("confirm")}</span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={input}
        />
      </label>
      {status === "mismatch" ? <p className="text-sm text-red-700">{t("mismatch")}</p> : null}
      {status === "error" ? <p className="text-sm text-red-700">{t("error")}</p> : null}
      {status === "saved" ? <p className="text-sm text-[var(--accent)]">{t("saved")}</p> : null}
      <button
        type="submit"
        disabled={status === "saving"}
        className="self-start rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {status === "saving" ? t("saving") : t("submit")}
      </button>
    </form>
  );
}
