"use client";

import { useState, useTransition } from "react";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/actions/client";
import { useRouter } from "@/i18n/routing";

export function MarkNotificationRead({ id }: { id: string }) {
  const [read, setRead] = useState(false);
  const [pending, startTransition] = useTransition();
  if (read) return <span className="text-xs text-[var(--muted)]">Read</span>;
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
      className="cursor-pointer text-xs underline disabled:opacity-60"
    >
      {pending ? "Saving…" : "Mark read"}
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
      className="cursor-pointer text-xs text-[var(--muted)] underline disabled:opacity-60"
    >
      {label}
    </button>
  );
}
