import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { Badge } from "@/components/ui";
import { PurchaseOrderProgress } from "@/components/orders/purchase-order-progress";
import { PURCHASE_ORDER_STEPS } from "@/lib/purchase-orders/core";
import type { PurchaseOrderRow } from "@/lib/purchase-orders/queries";
import { formatAmount, formatDate, formatNumber } from "@/lib/format";

/** Client-facing supplier order (never shows internal notes). */
export async function PurchaseOrderCard({ order, locale }: { order: PurchaseOrderRow; locale: "fr" | "en" }) {
  const t = await getTranslations("orders");
  const labels = Object.fromEntries(PURCHASE_ORDER_STEPS.map((step) => [step, t(`step.${step}`)]));
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={order.status === "cancelled" ? "grey" : order.status === "received" ? "green" : "gold"} dot>
          {t(`status.${order.status}`)}
        </Badge>
        <span className="font-mono text-xs text-[var(--muted)]">{order.reference}</span>
        <span className="ml-auto text-xs text-[var(--muted)]">{t("placed", { date: formatDate(order.created_at, locale) })}</span>
      </div>
      <p className="mt-1.5 text-base font-semibold">
        {formatNumber(order.quantity, locale)} ×{" "}
        {order.product_id ? (
          <Link href={`/products/${order.product_id}`} className="hover:underline">
            {order.title}
          </Link>
        ) : (
          order.title
        )}
      </p>
      <p className="mt-0.5 text-[13px] text-[var(--muted)]">
        {order.total_eur != null ? t("total", { amount: formatAmount(Number(order.total_eur), locale) }) : null}
        {order.eta ? ` · ${t("eta", { date: formatDate(`${order.eta}T00:00:00`, locale) })}` : null}
        {order.tracking ? ` · ${t("tracking", { tracking: order.tracking })}` : null}
      </p>
      {order.status !== "cancelled" ? (
        <div className="mt-3">
          <PurchaseOrderProgress status={order.status} labels={labels} />
        </div>
      ) : null}
      {order.notes_client ? (
        <p className="mt-3 rounded-lg bg-[var(--bg)] px-3 py-2 text-[13px]">{order.notes_client}</p>
      ) : null}
    </article>
  );
}
