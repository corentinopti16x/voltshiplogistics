import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { LifecycleStatus, SourcingStatus } from "@/lib/products/types";

export const lifecycleTone: Record<LifecycleStatus, BadgeTone> = {
  testing: "blue",
  winning: "gold",
  declining: "rust",
  dead: "grey",
  archived: "grey",
};

export function LifecycleBadge({ status }: { status: LifecycleStatus | null }) {
  if (!status) return null;
  return (
    <Badge tone={lifecycleTone[status]} className="uppercase">
      {status}
    </Badge>
  );
}

export function SourcingLabel({ status }: { status: SourcingStatus | null }) {
  const t = useTranslations("products.sourcing");
  if (!status) return null;
  return <span className="text-[12px] font-semibold text-[var(--muted)]">{t(status)}</span>;
}
