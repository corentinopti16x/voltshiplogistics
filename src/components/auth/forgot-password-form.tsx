"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm({
  configured,
  portal = "staff",
}: {
  configured: boolean;
  portal?: "client" | "staff";
}) {
  const loginHref = portal === "staff" ? "/staff/login" : "/login";
  const page = portal === "staff" ? "/staff/reset-password" : "/reset-password";
  const t = useTranslations("auth");
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const supabase = createClient();
      const next = locale === "fr" ? `/fr${page}` : page;
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });

      if (resetError) {
        const message = resetError.message.toLowerCase();
        if (message.includes("not found") || message.includes("user not")) {
          setSent(true);
          return;
        }
        setError(t("forgotError"));
        return;
      }

      setSent(true);
    } catch {
      setError(t("missingConfig"));
    } finally {
      setPending(false);
    }
  }

  if (!configured) {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {t("missingConfig")}
      </p>
    );
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-md border border-[var(--line)] bg-[#f3eee4] px-3 py-2 text-sm text-[var(--ink)]">
          {t("forgotSent")}
        </p>
        <Link href={loginHref} className="text-center text-xs font-medium text-[var(--ink)] underline">
          {t(portal === "staff" ? "forgotBack" : "forgotBackClient")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("email")}</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 outline-none focus:border-[var(--accent)]"
        />
      </label>
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? t("forgotSending") : t("forgotSubmit")}
      </button>
      <Link href={loginHref} className="text-center text-xs font-medium text-[var(--ink)] underline">
        {t(portal === "staff" ? "forgotBack" : "forgotBackClient")}
      </Link>
    </form>
  );
}
