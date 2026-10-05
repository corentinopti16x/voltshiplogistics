"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { startImpersonationAction } from "@/app/actions/admin";

export function ImpersonateButton({ clientId }: { clientId: string }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    setError(null);
    const result = await startImpersonationAction(clientId);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? t("impersonateError"));
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? t("impersonating") : t("viewAsClient")}
      </button>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
