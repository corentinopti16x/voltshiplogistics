"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/client";
import { stopImpersonationAction } from "@/app/actions/admin";

export function SignOutButton() {
  const t = useTranslations("dashboard");
  const router = useRouter();

  async function signOut() {
    await stopImpersonationAction();
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      className="cursor-pointer rounded-[9px] border border-white/25 px-3 py-1.5 text-[12px] font-semibold text-white/85 transition hover:bg-white/10 hover:text-white"
    >
      {t("signOut")}
    </button>
  );
}
