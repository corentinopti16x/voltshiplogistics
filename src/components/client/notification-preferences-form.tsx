"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { updateNotificationPreferencesAction } from "@/app/actions/client";
import type { ActionResult } from "@/app/actions/admin";
import {
  NOTIFICATION_EVENTS,
  type NotificationEvent,
} from "@/lib/notifications/events";

const initial: ActionResult = { ok: false };

export type PreferenceRow = {
  event_type: NotificationEvent;
  in_app: boolean;
  email: boolean;
  whatsapp: boolean;
};

export function NotificationPreferencesForm({
  preferences,
}: {
  preferences: PreferenceRow[];
}) {
  const t = useTranslations("settings.notifications");
  const [state, action, pending] = useActionState(
    updateNotificationPreferencesAction,
    initial,
  );
  const saved = new Map(preferences.map((row) => [row.event_type, row]));

  return (
    <form action={action} className="mt-8">
      <h2 className="text-sm font-semibold">{t("title")}</h2>
      <p className="mt-1 mb-4 text-sm text-[var(--muted)]">{t("lead")}</p>
      <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="border-b border-[var(--line)] text-xs text-[var(--muted)] uppercase">
            <tr>
              <th className="px-4 py-3">{t("event")}</th>
              <th className="px-4 py-3">{t("inApp")}</th>
              <th className="px-4 py-3">{t("email")}</th>
              <th className="px-4 py-3">{t("whatsapp")}</th>
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_EVENTS.map((eventType) => {
              const row = saved.get(eventType);
              return (
                <tr key={eventType} className="border-t border-[var(--line)]">
                  <td className="px-4 py-3">{t(`events.${eventType}`)}</td>
                  {(["in_app", "email", "whatsapp"] as const).map((channel) => (
                    <td key={channel} className="px-4 py-3">
                      <input
                        type="checkbox"
                        name={`${eventType}.${channel}`}
                        defaultChecked={row ? row[channel] : true}
                        aria-label={`${t(`events.${eventType}`)} ${t(channel === "in_app" ? "inApp" : channel)}`}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {state.error ? <p className="mt-3 text-sm text-red-700">{state.error}</p> : null}
      {state.ok ? <p className="mt-3 text-sm text-[var(--accent)]">{t("saved")}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? t("saving") : t("save")}
      </button>
    </form>
  );
}
