"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/client";
import {
  destinationForRole,
  roleBelongsToPortal,
  type AuthPortal,
} from "@/lib/auth/portals";
import type { UserRole } from "@/lib/auth/types";

export function LoginForm({
  configured,
  portal = "client",
}: {
  configured: boolean;
  portal?: AuthPortal;
}) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const supabase = createClient();

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(t("error"));
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError(t("error"));
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle<{ role: UserRole }>();

      const role = profile?.role;

      if (!role || !roleBelongsToPortal(role, portal)) {
        await supabase.auth.signOut();
        setError(portal === "staff" ? t("wrongPortalClient") : t("wrongPortalStaff"));
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
      <div className="flex flex-col gap-1.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${portal}-password`} className="text-[var(--muted)]">
            {t("password")}
          </label>
          <Link
            href={portal === "staff" ? "/staff/forgot-password" : "/forgot-password"}
            className="text-xs font-medium text-[var(--ink)] underline"
          >
            {t("forgotPassword")}
          </Link>
        </div>
        <input
          id={`${portal}-password`}
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 outline-none focus:border-[var(--accent)]"
        />
      </div>
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
        {pending ? t("submitting") : portal === "staff" ? t("staffSubmit") : t("submit")}
      </button>
      {portal === "client" ? (
        <>
          <p className="text-center text-xs text-[var(--muted)]">
            {t("staffEntry")}{" "}
            <Link href="/staff/login" className="font-medium text-[var(--ink)] underline">
              {t("staffSignIn")}
            </Link>
          </p>
        </>
      ) : (
        <>
          <p className="text-center text-xs text-[var(--muted)]">
            {t("clientEntry")}{" "}
            <Link href="/login" className="font-medium text-[var(--ink)] underline">
              {t("clientSignIn")}
            </Link>
          </p>
        </>
      )}
    </form>
  );
}
