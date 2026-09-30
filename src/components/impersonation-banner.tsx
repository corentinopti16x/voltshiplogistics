"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { stopImpersonationAction } from "@/app/actions/admin";

export function ImpersonationBanner({ clientName }: { clientName: string }) {
  const t = useTranslations("impersonate");
  const router = useRouter();

  async function stop() {
    await stopImpersonationAction();
    router.replace("/admin");
    router.refresh();
  }

  return (
    <div className="bg-[#24382c] px-6 py-2.5 text-sm text-[#f3eee4]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <p>
          {t("banner", { client: clientName })}
        </p>
        <button
          type="button"
          onClick={stop}
          className="rounded-full bg-[#f3eee4] px-3 py-1 text-xs font-medium text-[#132018]"
        >
          {t("stop")}
        </button>
      </div>
    </div>
  );
}
