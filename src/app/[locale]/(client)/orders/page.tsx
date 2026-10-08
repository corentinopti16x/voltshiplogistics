import { getLocale, getTranslations } from "next-intl/server";
import { getAuthContext } from "@/lib/auth/context";
import { listClientPurchaseOrders } from "@/lib/purchase-orders/queries";
import { isOpenPurchaseOrder } from "@/lib/purchase-orders/core";
import { PurchaseOrderCard } from "@/components/orders/purchase-order-card";
import { Card, EmptyState, PageTitle } from "@/components/ui";

export default async function PurchaseOrdersPage() {
  const [rawLocale, ctx, t] = await Promise.all([getLocale(), getAuthContext(), getTranslations("orders")]);
  const locale = rawLocale === "fr" ? "fr" : "en";
  const orders = ctx?.clientId ? await listClientPurchaseOrders(ctx.clientId).catch(() => []) : [];
  const open = orders.filter((order) => isOpenPurchaseOrder(order.status));
  const done = orders.filter((order) => !isOpenPurchaseOrder(order.status));

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <PageTitle bandClass="h-[250px]" title={t("title")} lead={open.length > 0 ? t("leadOpen", { count: open.length }) : t("lead")} />
      {orders.length === 0 ? (
        <Card padding="md">
          <EmptyState>{t("empty")}</EmptyState>
        </Card>
      ) : null}
      {open.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">{t("inProgress")}</h2>
          {open.map((order) => (
            <PurchaseOrderCard key={order.id} order={order} locale={locale} />
          ))}
        </section>
      ) : null}
      {done.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-[var(--muted)]">{t("history")}</h2>
          {done.map((order) => (
            <PurchaseOrderCard key={order.id} order={order} locale={locale} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
