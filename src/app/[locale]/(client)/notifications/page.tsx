import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MarkAllNotificationsRead,
  MarkNotificationRead,
} from "@/components/client/mark-notification-read";
import { Bolt, Card, EmptyState, PageTitle } from "@/components/ui";
import { formatDate } from "@/lib/format";

type NotificationRow = {
  id: string;
  type: string;
  created_at: string;
  read_at: string | null;
  payload_json: { message?: string; productId?: string } | null;
};

export default async function NotificationsPage() {
  const [t, locale] = await Promise.all([getTranslations("notificationsPage"), getLocale()]);
  const ctx = await getAuthContext();
  let rows: NotificationRow[] = [];

  if (ctx?.clientId) {
    try {
      const admin = createAdminClient();
      const { data } = await admin
        .from("notifications")
        .select("id, type, created_at, read_at, payload_json")
        .eq("client_id", ctx.clientId)
        .order("created_at", { ascending: false })
        .limit(50)
        .returns<NotificationRow[]>();
      rows = data ?? [];
    } catch {
      rows = [];
    }
  }

  // Unread first, newest first within each group.
  const ordered = [...rows.filter((row) => !row.read_at), ...rows.filter((row) => row.read_at)];
  const unreadCount = rows.length - rows.filter((row) => row.read_at).length;

  return (
    <div className="flex max-w-[820px] flex-col gap-5">
      <PageTitle
        bandClass="h-[250px]"
        title={t("title")}
        lead={unreadCount > 0 ? t("unreadCount", { count: unreadCount }) : t("lead")}
        actions={unreadCount > 0 ? <MarkAllNotificationsRead label={t("markAll")} /> : null}
      />
      {ordered.length === 0 ? (
        <Card padding="md">
          <EmptyState>{t("empty")}</EmptyState>
        </Card>
      ) : (
        <Card as="section" padding="none" className="overflow-hidden">
          <ul className="divide-y divide-[var(--line-soft)]">
            {ordered.map((row) => {
              const isUnread = !row.read_at;
              const message = row.payload_json?.message ?? row.type.replaceAll("_", " ");
              const productId = row.payload_json?.productId;
              return (
                <li
                  key={row.id}
                  className={`flex items-center gap-3.5 px-5 py-4 ${isUnread ? "bg-[#fffcf5]" : ""}`}
                >
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${
                      isUnread ? "bg-[var(--gold-soft)]" : "bg-[var(--grey-soft)]"
                    }`}
                  >
                    <Bolt fill={isUnread ? "#D9A03A" : "#9AA8BA"} />
                  </span>
                  <div className="min-w-0 flex-1">
                    {productId ? (
                      <Link
                        href={`/products/${productId}`}
                        className={`block truncate text-sm hover:underline ${isUnread ? "font-bold" : "font-medium"}`}
                      >
                        {message}
                      </Link>
                    ) : (
                      <p className={`truncate text-sm ${isUnread ? "font-bold" : "font-medium"}`}>{message}</p>
                    )}
                    <p className="mt-0.5 text-[12px] text-[var(--muted)]">
                      {formatDate(row.created_at, locale, true)}
                    </p>
                  </div>
                  {row.read_at ? (
                    <span className="text-[12px] text-[var(--faint)]">{t("read")}</span>
                  ) : (
                    <MarkNotificationRead id={row.id} />
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
