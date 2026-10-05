import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { getMailbox, listSupportThreads } from "@/lib/support/queries";
import { IntentBadge, ThreadStatusBadge } from "@/components/client/support-badges";
import { SupportSyncButton } from "@/components/client/support-sync-button";
import { Badge, ButtonLink, Card, EmptyState, PageTitle } from "@/components/ui";
import { formatDate } from "@/lib/format";

type Filter = "all" | "open" | "answered" | "closed";

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const [t, locale, ctx, query] = await Promise.all([getTranslations("support"), getLocale(), getAuthContext(), searchParams]);
  const filter: Filter = (["open", "answered", "closed"] as const).find((f) => f === query.status) ?? "all";
  const clientId = ctx?.clientId;
  const [threads, mailbox] = clientId
    ? await Promise.all([listSupportThreads(clientId).catch(() => []), getMailbox(clientId).catch(() => null)])
    : [[], null];
  const visible = filter === "all" ? threads : threads.filter((thread) => thread.status === filter);
  const openCount = threads.filter((thread) => thread.status === "open").length;
  const connected = Boolean(mailbox?.enabled);

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        bandClass="h-[250px]"
        title={t("title")}
        lead={
          connected
            ? `${t("lastSync")} ${mailbox?.last_sync_at ? formatDate(mailbox.last_sync_at, locale, true) : t("never")}`
            : t("lead")
        }
        actions={connected ? <SupportSyncButton /> : null}
      />

      {!connected ? (
        <Card padding="md">
          <EmptyState>{t("empty")}</EmptyState>
          {ctx?.role !== "staff" ? (
            <div className="mt-3">
              <ButtonLink href="/settings" variant="secondary" size="sm">
                {t("goSettings")}
              </ButtonLink>
            </div>
          ) : null}
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "open", "answered", "closed"] as const).map((key) => (
              <Link
                key={key}
                href={key === "all" ? "/support" : `/support?status=${key}`}
                className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${
                  filter === key
                    ? "bg-[var(--navy)] text-white"
                    : "border border-[var(--line)] bg-[var(--card)] text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {t(`filters.${key}`)}
                {key === "open" && openCount > 0 ? ` · ${openCount}` : ""}
              </Link>
            ))}
          </div>
          {visible.length === 0 ? (
            <Card padding="md">
              <EmptyState>{t("empty")}</EmptyState>
            </Card>
          ) : (
            <Card as="section" padding="none" className="overflow-hidden">
              <ul className="divide-y divide-[var(--line-soft)]">
                {visible.map((thread) => (
                  <li key={thread.id} className={thread.status === "open" ? "bg-[#fffcf5]" : ""}>
                    <Link href={`/support/${thread.id}`} className="block px-5 py-4 hover:bg-[var(--card-soft)]">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{thread.customer_name ?? t("unknownCustomer")}</p>
                        <ThreadStatusBadge status={thread.status} />
                        <IntentBadge intent={thread.intent} />
                        {thread.matched_order_number ? (
                          <Badge tone="navy">#{thread.matched_order_number}</Badge>
                        ) : (
                          <Badge tone="outline">{t("noOrder")}</Badge>
                        )}
                        <span className="ml-auto text-[12px] text-[var(--muted)]">
                          {thread.last_message_at ? formatDate(thread.last_message_at, locale, true) : ""}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium">{thread.subject || t("noSubject")}</p>
                      <p className="mt-0.5 truncate text-[13px] text-[var(--muted)]">
                        {thread.last_direction === "out" ? `${t("thread.store")} : ` : ""}
                        {thread.snippet}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
