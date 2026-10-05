"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/client";
import { destinationForRole, isInternalRole } from "@/lib/auth/portals";
import type { UserRole } from "@/lib/auth/types";

export function ResetPasswordForm({ configured }: { configured: boolean }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(configured);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    if (!configured) return;

    let cancelled = false;
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setHasSession(Boolean(data.user));
      setChecking(false);
    });

    return () => {
      cancelled = true;
    };
  }, [configured]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError(t("passwordMismatch"));
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(t("resetError"));
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/staff/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle<{ role: UserRole }>();

      const role = profile?.role;
      if (!role || !isInternalRole(role)) {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      router.replace(destinationForRole(role));
      router.refresh();
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

  if (checking) {
    return <p className="text-sm text-[var(--muted)]">{t("submitting")}</p>;
  }

  if (!hasSession) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-red-700" role="alert">
          {t("resetMissingSession")}
        </p>
        <Link
          href="/staff/forgot-password"
          className="text-center text-xs font-medium text-[var(--ink)] underline"
        >
          {t("resetRequestAgain")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("password")}</span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 outline-none focus:border-[var(--accent)]"
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
        {pending ? t("resetSaving") : t("resetSubmit")}
      </button>
    </form>
  );
}
