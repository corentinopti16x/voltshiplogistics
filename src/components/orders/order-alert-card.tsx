import { Badge, Card } from "@/components/ui";
import { OrderAlertDecision, OrderAlertReplyForm } from "@/components/orders/order-alert-forms";
import { ORDER_ALERT_LABELS, parseAlertReasons } from "@/lib/orders/anomalies";
import type { OrderAlertView } from "@/lib/orders/alerts-queries";
import { formatAmount, formatDate } from "@/lib/format";

const statusBadge = {
  open: { tone: "gold", label: "À vérifier" },
  legit: { tone: "green", label: "Vraie commande" },
  abuse: { tone: "rust", label: "Abus confirmé" },
} as const;

/** One flagged order with its reasons, figures and shared thread (Voltship ↔ client). */
export function OrderAlertCard({
  alert,
  locale,
  showClient = false,
  viewer,
}: {
  alert: OrderAlertView;
  locale: string;
  showClient?: boolean;
  /** Who is reading: their own messages are on the right. */
  viewer: "client" | "voltship";
}) {
  const reasons = parseAlertReasons(alert.reasons);
  const details = alert.details ?? {};
  const currency = details.currency === "USD" ? "USD" : "EUR";
  const badge = statusBadge[alert.status] ?? statusBadge.open;
  const money = (value: number | null | undefined) =>
    value == null ? "—" : formatAmount(value, locale, currency);

  return (
    <Card as="article" padding="md" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-bold">
              Commande {alert.order_number ? `#${alert.order_number}` : alert.shopify_order_id}
            </h2>
            <Badge tone={badge.tone} dot>
              {badge.label}
            </Badge>
          </div>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            {showClient && alert.clientName ? `${alert.clientName} · ` : ""}
            {alert.placed_at ? formatDate(alert.placed_at, locale, true) : "—"}
          </p>
        </div>
        <OrderAlertDecision alertId={alert.id} status={alert.status} />
      </div>

      <ul className="flex flex-col gap-1.5">
        {reasons.map((reason) => (
          <li key={reason} className="text-sm">
            <span className="font-semibold">{ORDER_ALERT_LABELS[reason].title}</span>
            <span className="text-[var(--muted)]"> — {ORDER_ALERT_LABELS[reason].help}</span>
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-2 gap-3 rounded-xl bg-[var(--card-soft)] px-4 py-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-[12px] text-[var(--muted)]">Payé</dt>
          <dd className="font-semibold">{money(details.total)}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-[var(--muted)]">Prix des produits</dt>
          <dd className="font-semibold">{money(details.gross)}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-[var(--muted)]">Remise</dt>
          <dd className="font-semibold">
            {money(details.discounts)}
            {details.discount_pct != null ? ` (${details.discount_pct} %)` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] text-[var(--muted)]">Articles</dt>
          <dd className="font-semibold">{details.units ?? "—"}</dd>
        </div>
        {details.discount_codes && details.discount_codes.length > 0 ? (
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-[12px] text-[var(--muted)]">Code promo</dt>
            <dd className="font-semibold">{details.discount_codes.join(", ")}</dd>
          </div>
        ) : null}
      </dl>

      {alert.messages.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {alert.messages.map((message) =>
            message.author_role === "system" ? (
              <li key={message.id} className="text-center text-[12px] text-[var(--muted)]">
                {message.body} · {formatDate(message.created_at, locale, true)}
              </li>
            ) : (
              <li
                key={message.id}
                className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm ${
                  message.author_role === viewer
                    ? "self-end bg-[var(--navy)] text-white"
                    : "self-start bg-[var(--card-soft)]"
                }`}
              >
                <p className="text-[11px] font-semibold opacity-70">
                  {message.author_role === "voltship" ? "Voltship" : "Client"} ·{" "}
                  {formatDate(message.created_at, locale, true)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap">{message.body}</p>
              </li>
            ),
          )}
        </ul>
      ) : null}

      <OrderAlertReplyForm alertId={alert.id} />
    </Card>
  );
}
