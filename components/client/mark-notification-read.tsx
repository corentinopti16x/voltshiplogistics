"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/actions/client";
import { useRouter } from "@/i18n/routing";

export function MarkNotificationRead({ id }: { id: string }) {
  const t = useTranslations("notificationsPage");
  const [read, setRead] = useState(false);
  const [pending, startTransition] = useTransition();
  if (read) return <span className="text-xs text-[var(--muted)]">{t("read")}</span>;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markNotificationReadAction(id);
          if (result.ok) setRead(true);
        })
      }
      className="cursor-pointer rounded-[9px] border border-[#d4dde9] bg-white px-3 py-1.5 text-[12px] font-semibold text-[var(--ink)] hover:border-[var(--navy)] disabled:opacity-60"
    >
      {pending ? t("saving") : t("markRead")}
    </button>
  );
}

export function MarkAllNotificationsRead({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markAllNotificationsReadAction();
          if (result.ok) router.refresh();
        })
      }
      className="cursor-pointer rounded-[9px] border border-white/30 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-white/10 disabled:opacity-60"
    >
      {label}
    </button>
  );
}
