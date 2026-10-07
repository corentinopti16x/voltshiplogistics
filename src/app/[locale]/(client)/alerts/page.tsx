import { getLocale } from "next-intl/server";
import { getAuthContext } from "@/lib/auth/context";
import { listOrderAlerts } from "@/lib/orders/alerts-queries";
import { OrderAlertCard } from "@/components/orders/order-alert-card";
import { Card, EmptyState, PageTitle } from "@/components/ui";

export default async function OrderAlertsPage() {
  const [locale, ctx] = await Promise.all([getLocale(), getAuthContext()]);
  const alerts = ctx?.clientId ? await listOrderAlerts({ clientId: ctx.clientId }) : [];
  const open = alerts.filter((alert) => alert.status === "open").length;

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <PageTitle
        bandClass="h-[250px]"
        title="Commandes à vérifier"
        lead={
          open > 0
            ? `${open} commande${open > 1 ? "s" : ""} inhabituelle${open > 1 ? "s" : ""} à regarder avec Voltship : code promo abusé, commande à 0 €, prix ou quantité anormale.`
            : "Les commandes inhabituelles (code promo abusé, commande à 0 €, prix ou quantité anormale) apparaissent ici. Tu peux en parler avec Voltship directement dans chaque alerte."
        }
      />
      {alerts.length === 0 ? (
        <Card padding="md">
          <EmptyState>Aucune commande à vérifier pour l&apos;instant.</EmptyState>
        </Card>
      ) : (
        alerts.map((alert) => (
          <OrderAlertCard key={alert.id} alert={alert} locale={locale} viewer="client" />
        ))
      )}
    </div>
  );
}
