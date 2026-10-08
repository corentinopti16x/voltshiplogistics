import { PURCHASE_ORDER_STEPS, stepIndex } from "@/lib/purchase-orders/core";

/** Step bar: Paiement → Production → Contrôle → Vers l'entrepôt → Reçue. */
export function PurchaseOrderProgress({ status, labels }: { status: string; labels: Record<string, string> }) {
  const current = stepIndex(status);
  if (current < 0) return null;
  return (
    <ol className="flex w-full gap-1">
      {PURCHASE_ORDER_STEPS.map((step, index) => (
        <li key={step} className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className={`h-1.5 rounded-full ${index <= current ? (index === current && step !== "received" ? "bg-[var(--gold-bright)]" : "bg-[var(--green-ink)]") : "bg-[var(--line)]"}`}
          />
          <span
            className={`truncate text-[11px] ${index === current ? "font-bold text-[var(--ink)]" : "text-[var(--muted)]"}`}
          >
            {labels[step]}
          </span>
        </li>
      ))}
    </ol>
  );
}
