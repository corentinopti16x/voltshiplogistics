import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/components/ui";
import type { SupportIntent } from "@/lib/support/draft";
import type { PublicFulfillmentStatus } from "@/lib/public-api/orders";

const statusTone: Record<"open" | "answered" | "closed", BadgeTone> = { open: "gold", answered: "blue", closed: "grey" };
const fulfillmentTone: Record<PublicFulfillmentStatus, BadgeTone> = {
  received: "grey",
  preparing: "gold",
  shipped: "blue",
  delivered: "green",
  cancelled: "rust",
  unknown: "rust",
};

export function ThreadStatusBadge({ status }: { status: "open" | "answered" | "closed" }) {
  const t = useTranslations("support");
  return (
    <Badge tone={statusTone[status]} dot>
      {t(status)}
    </Badge>
  );
}

export function IntentBadge({ intent }: { intent: SupportIntent | null }) {
  const t = useTranslations("support");
  if (!intent) return null;
  return <Badge tone="outline">{t(`intent.${intent}`)}</Badge>;
}

export function FulfillmentBadge({ status }: { status: PublicFulfillmentStatus }) {
  const t = useTranslations("support");
  return <Badge tone={fulfillmentTone[status]}>{t(`fulfillment.${status}`)}</Badge>;
}
