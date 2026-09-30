"use client";

import { useActionState, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/client";
import { signUpAction, type ActionResult } from "@/app/actions/signup";

const initial: ActionResult = { ok: false };

export function SignupForm({
  configured,
  firstAdmin,
}: {
  configured: boolean;
  firstAdmin: boolean;
}) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [state, action, pending] = useActionState(signUpAction, initial);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!state.ok || !email || !password) return;

    let cancelled = false;

    async function signIn() {
      setSigningIn(true);
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (cancelled) return;
      if (error) {
        router.replace(firstAdmin ? "/staff/login" : "/login");
        return;
      }
      router.replace(firstAdmin ? "/admin" : "/dashboard");
      router.refresh();
    }

    void signIn();
    return () => {
      cancelled = true;
    };
  }, [state.ok, email, password, router, firstAdmin]);

  if (!configured) {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {t("missingConfig")}
      </p>
    );
  }

  const busy = pending || signingIn;

  return (
    <form action={action} className="flex flex-col gap-4">
      {!firstAdmin ? (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[var(--muted)]">{t("company")}</span>
          <input
            name="company"
            required
            minLength={2}
            className="rounded-md border border-[var(--line)] bg-white px-3 py-2 outline-none focus:border-[var(--accent)]"
          />
        </label>
      ) : (
        <p className="rounded-md border border-[var(--line)] bg-[#f3eee4] px-3 py-2 text-xs text-[var(--muted)]">
          {t("firstAdminHint")}
        </p>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("email")}</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 outline-none focus:border-[var(--accent)]"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-[var(--muted)]">{t("password")}</span>
        <input
          type="password"
          name="password"
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
          name="confirm"
          required
          minLength={8}
          autoComplete="new-password"
          className="rounded-md border border-[var(--line)] bg-white px-3 py-2 outline-none focus:border-[var(--accent)]"
        />
      </label>
      <input type="hidden" name="language" value={locale === "fr" ? "fr" : "en"} />
      {state.error ? (
        <p className="text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="mt-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy ? t("creating") : t("createAccount")}
      </button>
      <p className="text-center text-xs text-[var(--muted)]">
        {t("hasAccount")}{" "}
        <Link href="/login" className="font-medium text-[var(--ink)] underline">
          {t("title")}
        </Link>
      </p>
    </form>
  );
}
