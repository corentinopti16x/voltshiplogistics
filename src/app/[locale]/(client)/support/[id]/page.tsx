import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { getSupportThread } from "@/lib/support/queries";
import { buildOrderContext } from "@/lib/support/sync";
import { FulfillmentBadge, IntentBadge, ThreadStatusBadge } from "@/components/client/support-badges";
import { SupportReplyBox } from "@/components/client/support-reply-box";
import { Card, SectionTitle } from "@/components/ui";
import { formatDate } from "@/lib/format";

export default async function SupportThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, t, locale, ctx] = await Promise.all([params, getTranslations("support"), getLocale(), getAuthContext()]);
  if (!ctx?.clientId) notFound();
  const data = await getSupportThread(ctx.clientId, id).catch(() => null);
  if (!data) notFound();
  const { thread, messages, draft } = data;
  const order = thread.matched_order_id ? await buildOrderContext(ctx.clientId, thread.matched_order_id).catch(() => null) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="pt-2">
        <Link href="/support" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
          ← {t("thread.back")}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-bold">{thread.subject || t("noSubject")}</h1>
          <ThreadStatusBadge status={thread.status} />
          <IntentBadge intent={draft?.intent ?? null} />
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {t("thread.customer")} : {thread.customer_name ?? t("unknownCustomer")}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="flex flex-col gap-5">
          <Card as="section" padding="none" className="overflow-hidden">
            <ul className="divide-y divide-[var(--line-soft)]">
              {messages.map((message) => (
                <li key={message.id} className={`px-5 py-4 ${message.direction === "out" ? "bg-[var(--blue-soft)]/40" : ""}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[13px] font-semibold">
                      {message.direction === "out" ? t("thread.store") : message.from_name ?? t("thread.customer")}
                    </p>
                    <span className="text-[12px] text-[var(--muted)]">{formatDate(message.received_at, locale, true)}</span>
                  </div>
                  <p className="mt-1.5 text-sm whitespace-pre-wrap">{message.body_text}</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card as="section" padding="md">
            <SectionTitle
              sub={draft ? t("thread.draftLead") : t("thread.noDraft")}
              aside={
                draft?.confidence != null ? `${Math.round(Number(draft.confidence) * 100)} % ${t("thread.confidence")}` : null
              }
            >
              {t("thread.draftTitle")}
            </SectionTitle>
            <div className="mt-4">
              <SupportReplyBox threadId={thread.id} draftId={draft?.id ?? null} draftBody={draft?.body_text ?? ""} status={thread.status} />
            </div>
          </Card>
        </div>

        <Card as="section" padding="md">
          <SectionTitle size="sm">{t("thread.orderCard")}</SectionTitle>
          {order ? (
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("order")}</dt>
                <dd className="flex items-center gap-2 font-semibold">
                  #{order.number ?? "?"} <FulfillmentBadge status={order.status} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("thread.carrier")}</dt>
                <dd>{order.carrier ?? "—"}{order.service ? ` · ${order.service}` : ""}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("thread.shippedAt")}</dt>
                <dd>{order.shippedAt ? formatDate(order.shippedAt, locale, true) : "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("thread.eta")}</dt>
                <dd>{order.eta ?? "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--muted)]">{t("thread.tracking")}</dt>
                <dd className="text-right">
                  {order.trackingNumber ? (
                    order.trackingUrl ? (
                      <a href={order.trackingUrl} target="_blank" rel="noreferrer" className="font-mono text-[var(--blue-ink)] hover:underline">
                        {order.trackingNumber}
                      </a>
                    ) : (
                      <span className="font-mono">{order.trackingNumber}</span>
                    )
                  ) : (
                    <span className="text-[var(--muted)]">{t("thread.noTracking")}</span>
                  )}
                </dd>
              </div>
              <div className="mt-2 border-t border-[var(--line)] pt-2">
                <dt className="text-[var(--muted)]">{t("thread.items")}</dt>
                <dd>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {order.items.map((item) => (
                      <li key={item.sku} className="flex justify-between gap-3">
                        <span className="truncate">{item.title ?? item.sku}</span>
                        <span className="text-[var(--muted)]">× {item.qty}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">{t("noOrder")}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
