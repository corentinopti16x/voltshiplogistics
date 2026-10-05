"use client";

import { useTransition, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { syncSupportNowAction } from "@/app/actions/support";
import { Button } from "@/components/ui";

export function SupportSyncButton() {
  const t = useTranslations("support");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="gold"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await syncSupportNowAction();
            setError(result.ok ? null : result.error ?? "Sync failed.");
            router.refresh();
          })
        }
      >
        {pending ? t("syncing") : t("syncNow")}
      </Button>
      {error ? <span className="text-xs text-white/80">{error}</span> : null}
    </div>
  );
}
