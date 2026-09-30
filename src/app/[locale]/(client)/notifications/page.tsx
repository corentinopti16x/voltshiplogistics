import { getTranslations } from "next-intl/server";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MarkAllNotificationsRead,
  MarkNotificationRead,
} from "@/components/client/mark-notification-read";

export default async function NotificationsPage() {
  const t = await getTranslations("notificationsPage");
  const ctx = await getAuthContext();
  let rows: {
    id: string;
    type: string;
    created_at: string;
    read_at: string | null;
    payload_json: { message?: string } | null;
  }[] = [];

  if (ctx?.clientId) {
    try {
      const admin = createAdminClient();
      const { data } = await admin
        .from("notifications")
        .select("id, type, created_at, read_at, payload_json")
        .eq("client_id", ctx.clientId)
        .order("created_at", { ascending: false })
        .limit(50);
      rows = data ?? [];
    } catch {
      rows = [];
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{t("lead")}</p>
        </div>
        {rows.some((row) => !row.read_at) ? (
          <MarkAllNotificationsRead label={t("markAll")} />
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-8 text-sm text-[var(--muted)]">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-4 px-5 py-4 text-sm">
              <div>
                <p>
                  {row.payload_json && typeof row.payload_json === "object" && row.payload_json.message
                    ? row.payload_json.message
                    : row.type}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {new Date(row.created_at).toLocaleString()}
                </p>
              </div>
              {row.read_at ? (
                <span className="text-xs text-[var(--muted)]">{t("read")}</span>
              ) : (
                <MarkNotificationRead id={row.id} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
