"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { markThreadResolvedAction, sendSupportReplyAction, type SupportActionResult } from "@/app/actions/support";
import { Button } from "@/components/ui";

const initial: SupportActionResult = { ok: false };

export function SupportReplyBox({
  threadId,
  draftId,
  draftBody,
  status,
}: {
  threadId: string;
  draftId: string | null;
  draftBody: string;
  status: "open" | "answered" | "closed";
}) {
  const t = useTranslations("support.thread");
  const [sendState, sendAction, sending] = useActionState(sendSupportReplyAction, initial);
  const [resolveState, resolveAction, resolving] = useActionState(markThreadResolvedAction, initial);

  return (
    <div className="flex flex-col gap-3">
      <form action={sendAction} className="flex flex-col gap-3">
        <input type="hidden" name="thread_id" value={threadId} />
        {draftId ? <input type="hidden" name="draft_id" value={draftId} /> : null}
        <textarea
          name="body"
          defaultValue={draftBody}
          rows={12}
          className="vs-input min-h-[220px] w-full resize-y font-[inherit] leading-relaxed"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={sending}>
            {sending ? t("sending") : t("send")}
          </Button>
          {sendState.ok ? <span className="text-xs text-[var(--green-ink)]">{t("sent")}</span> : null}
          {sendState.error ? <span className="text-xs text-[var(--rust-ink)]">{sendState.error}</span> : null}
        </div>
      </form>
      <form action={resolveAction} className="flex items-center gap-2 border-t border-[var(--line)] pt-3">
        <input type="hidden" name="thread_id" value={threadId} />
        {status === "closed" ? <input type="hidden" name="reopen" value="1" /> : null}
        <Button type="submit" variant="secondary" size="sm" disabled={resolving}>
          {status === "closed" ? t("reopen") : t("resolve")}
        </Button>
        {resolveState.error ? <span className="text-xs text-[var(--rust-ink)]">{resolveState.error}</span> : null}
      </form>
    </div>
  );
}
