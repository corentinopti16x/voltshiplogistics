import { getLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { listOrderAlerts } from "@/lib/orders/alerts-queries";
import { OrderAlertCard } from "@/components/orders/order-alert-card";

export default async function AdminOrderAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ status }, locale] = await Promise.all([searchParams, getLocale()]);
  const showAll = status === "all";
  const alerts = await listOrderAlerts({ status: showAll ? "all" : "open", limit: 100 });

  return (
    <div className="flex max-w-[900px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">
            Opérations Voltship
          </p>
          <h1 className="font-display mt-2 text-3xl">Commandes à vérifier</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Commandes inhabituelles de tous les clients. Le client voit la même alerte et le même fil
            de discussion dans son espace.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link
            href="/admin/alerts"
            className={`rounded-full px-3 py-1.5 ${showAll ? "text-[var(--muted)]" : "bg-[var(--navy)] text-white"}`}
          >
            À traiter
          </Link>
          <Link
            href="/admin/alerts?status=all"
            className={`rounded-full px-3 py-1.5 ${showAll ? "bg-[var(--navy)] text-white" : "text-[var(--muted)]"}`}
          >
            Toutes
          </Link>
        </div>
      </div>
      {alerts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-8 text-sm text-[var(--muted)]">
          {showAll ? "Aucune alerte pour l'instant." : "Rien à traiter."}
        </p>
      ) : (
        alerts.map((alert) => (
          <OrderAlertCard key={alert.id} alert={alert} locale={locale} showClient viewer="voltship" />
        ))
      )}
    </div>
  );
}
