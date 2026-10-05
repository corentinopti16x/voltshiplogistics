"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { disconnectGmailAction, type SupportActionResult } from "@/app/actions/support";
import type { MailboxSummary } from "@/lib/support/queries";
import { Badge, Button, EmptyState, SectionTitle, buttonClass } from "@/components/ui";

const initial: SupportActionResult = { ok: false };

function DisconnectButton({ mailboxId }: { mailboxId: string }) {
  const t = useTranslations("settings.gmail");
  const [armed, setArmed] = useState(false);
  const [state, action, pending] = useActionState(disconnectGmailAction, initial);
  if (!armed) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setArmed(true)}>
        {t("disconnect")}
      </Button>
    );
  }
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="mailbox_id" value={mailboxId} />
      <Button variant="ghost" size="sm" onClick={() => setArmed(false)} disabled={pending}>
        {t("cancel")}
      </Button>
      <Button type="submit" size="sm" className="bg-[var(--rust-ink)] hover:bg-[var(--rust-ink)]" disabled={pending}>
        {pending ? t("disconnecting") : t("confirmDisconnect")}
      </Button>
      {state.error ? <span className="text-xs text-[var(--rust-ink)]">{state.error}</span> : null}
    </form>
  );
}

export function GmailMailboxCard({
  mailbox,
  canConnect,
  configured,
  connected,
  error,
}: {
  mailbox: MailboxSummary | null;
  canConnect: boolean;
  configured: boolean;
  connected: boolean;
  error: string | null;
}) {
  const t = useTranslations("settings.gmail");
  const locale = useLocale();
  const status = !mailbox || !mailbox.enabled ? "disconnected" : mailbox.sync_error ? "error" : "connected";

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle sub={t("lead")}>{t("title")}</SectionTitle>
      {connected ? (
        <p className="rounded-[10px] bg-[var(--green-soft)] px-3 py-2 text-sm text-[var(--green-ink)]">
          {t("connectedBanner")}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-[10px] bg-[var(--rust-soft)] px-3 py-2 text-sm text-[var(--rust-ink)]">{error}</p>
      ) : null}

      {!mailbox || !mailbox.enabled ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-4 py-3 text-sm">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{mailbox.email_address}</p>
              <Badge tone={status === "connected" ? "green" : status === "error" ? "rust" : "grey"} dot>
                {t(`status.${status}`)}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {t("lastSync")} {mailbox.last_sync_at ? new Date(mailbox.last_sync_at).toLocaleString(locale) : t("never")}
            </p>
            {mailbox.sync_error ? <p className="mt-1 text-xs text-[var(--rust-ink)]">{mailbox.sync_error}</p> : null}
          </div>
          {canConnect ? <DisconnectButton mailboxId={mailbox.id} /> : null}
        </div>
      )}

      {canConnect ? (
        configured ? (
          <form method="get" action="/api/support/gmail/connect" className="flex flex-col gap-3 border-t border-[var(--line)] pt-4">
            <input type="hidden" name="locale" value={locale} />
            <p className="text-xs text-[var(--muted)]">{t("scopes")}</p>
            <button type="submit" className={buttonClass("primary", "md", "self-start")}>
              {t("connect")}
            </button>
          </form>
        ) : (
          <p className="text-xs text-[var(--muted)]">{t("notConfigured")}</p>
        )
      ) : (
        <p className="text-xs text-[var(--muted)]">{t("ownerOnly")}</p>
      )}
    </div>
  );
}
