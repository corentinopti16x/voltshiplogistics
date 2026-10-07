"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  postOrderAlertMessageAction,
  resolveOrderAlertAction,
} from "@/app/actions/order-alerts";
import type { ActionResult } from "@/app/actions/admin";
import { buttonClass } from "@/components/ui/button";

const initial: ActionResult = { ok: false };

export function OrderAlertReplyForm({ alertId }: { alertId: string }) {
  const [state, action, pending] = useActionState(postOrderAlertMessageAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <input type="hidden" name="alert_id" value={alertId} />
      <textarea
        name="body"
        rows={2}
        required
        minLength={2}
        maxLength={2000}
        placeholder="Écrire un message…"
        className="min-h-[44px] flex-1 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-sm"
      />
      <button type="submit" disabled={pending} className={buttonClass("secondary", "sm", "sm:mt-1")}>
        {pending ? "Envoi…" : "Envoyer"}
      </button>
      {state.error ? <p className="text-sm text-red-700 sm:basis-full">{state.error}</p> : null}
    </form>
  );
}

export function OrderAlertDecision({
  alertId,
  status,
}: {
  alertId: string;
  status: "open" | "legit" | "abuse";
}) {
  const [state, action, pending] = useActionState(resolveOrderAlertAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="alert_id" value={alertId} />
      {status === "open" ? (
        <>
          <button
            type="submit"
            name="decision"
            value="legit"
            disabled={pending}
            className={buttonClass("primary", "sm")}
          >
            Vraie commande
          </button>
          <button
            type="submit"
            name="decision"
            value="abuse"
            disabled={pending}
            className={buttonClass("secondary", "sm")}
          >
            Abus confirmé
          </button>
        </>
      ) : (
        <button
          type="submit"
          name="decision"
          value="open"
          disabled={pending}
          className={buttonClass("ghost", "sm")}
        >
          Rouvrir
        </button>
      )}
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
    </form>
  );
}
