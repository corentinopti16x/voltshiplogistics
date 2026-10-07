"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { requestOpsFollowUpAction } from "@/app/actions/client";
import type { ActionResult } from "@/app/actions/admin";
import type { LifecycleStatus } from "@/lib/products/types";
import { Button, buttonClass } from "@/components/ui/button";

const initial: ActionResult = { ok: false };

export function LifecycleBanner({
  status,
  productId,
  daysLeft,
}: {
  status: LifecycleStatus | null;
  productId: string;
  daysLeft: number | null;
}) {
  const t = useTranslations("products.lifecycleBanner");
  const [state, action, pending] = useActionState(requestOpsFollowUpAction, initial);

  if (!status || status === "archived") return null;

  const followUp = (kind: "packaging" | "clearance", label: string) => (
    <form action={action}>
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="kind" value={kind} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending || state.ok}>
        {pending ? t("sending") : state.ok ? t("sent") : label}
      </Button>
    </form>
  );

  let message = "";
  let actions = null;

  if (status === "winning") {
    message = t("winning");
    actions = (
      <>
        <a href="#stock" className={buttonClass("primary", "sm")}>
          {t("secureRestock")}
        </a>
        {followUp("packaging", t("packaging"))}
      </>
    );
  } else if (status === "testing") {
    message = t("testing");
  } else if (status === "declining") {
    message =
      daysLeft == null
        ? t("decliningUnknown")
        : t("declining", { days: Math.max(0, Math.round(daysLeft)) });
    actions = (
      <a href="#stock" className={buttonClass("secondary", "sm")}>
        {t("reviewStock")}
      </a>
    );
  } else if (status === "dead") {
    message = t("dead");
    actions = followUp("clearance", t("clearance"));
  } else {
    return null;
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#f0d9b5] bg-[var(--gold-soft)] px-5 py-3.5">
      <p className="text-sm font-medium text-[var(--gold-ink)]">{message}</p>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {state.error ? (
          <p className="text-xs text-[var(--rust-ink)]" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
