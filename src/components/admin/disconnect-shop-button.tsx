"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { disconnectShopAdminAction } from "@/app/actions/shopify";

export function DisconnectShopButton({ shopId }: { shopId: string }) {
  const t = useTranslations("admin.shopForms");
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="cursor-pointer rounded-md border border-[var(--line)] px-3 py-1.5 text-red-700 hover:bg-white"
      >
        {t("disconnect")}
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setArmed(false)}
        disabled={pending}
        className="cursor-pointer rounded-md px-3 py-1.5 text-[var(--muted)] hover:bg-white"
      >
        {t("cancel")}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              await disconnectShopAdminAction(shopId);
              setArmed(false);
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : t("disconnectFailed"));
            }
          })
        }
        className="cursor-pointer rounded-md bg-red-700 px-3 py-1.5 text-white disabled:opacity-60"
      >
        {pending ? t("disconnecting") : t("confirmDisconnect")}
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}
