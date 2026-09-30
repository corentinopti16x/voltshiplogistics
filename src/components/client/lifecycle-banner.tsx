"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { requestOpsFollowUpAction } from "@/app/actions/client";
import type { ActionResult } from "@/app/actions/admin";
import type { LifecycleStatus } from "@/lib/products/types";

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
      <button
        type="submit"
        disabled={pending || state.ok}
        className="cursor-pointer rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? t("sending") : state.ok ? t("sent") : label}
      </button>
    </form>
  );

  let message = "";
  let actions = null;

  if (status === "winning") {
    message = t("winning");
    actions = (
      <>
        <a
          href="#stock"
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
        >
          {t("secureRestock")}
        </a>
        {followUp("packaging", t("packaging"))}
      </>
    );
  } else if (status === "testing") {
    message = t("testing");
    actions = (
      <a
        href="#research"
        className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
      >
        {t("generate")}
      </a>
    );
  } else if (status === "declining") {
    message =
      daysLeft == null
        ? t("decliningUnknown")
        : t("declining", { days: Math.max(0, Math.round(daysLeft)) });
    actions = (
      <a
        href="#stock"
        className="rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium"
      >
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
    <section className="mt-6 rounded-2xl border border-[#d8bf76] bg-[#fbf5df] px-5 py-4">
      <p className="text-sm">{message}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {actions}
        {state.error ? (
          <p className="text-xs text-red-700" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
