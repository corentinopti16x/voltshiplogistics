"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createApiKeyAction, revokeApiKeyAction, type SupportActionResult } from "@/app/actions/support";
import type { ApiKeyRow } from "@/lib/support/queries";
import { Badge, Button, EmptyState, SectionTitle } from "@/components/ui";

const initial: SupportActionResult = { ok: false };

function RevokeButton({ keyId }: { keyId: string }) {
  const t = useTranslations("settings.apiKeys");
  const [armed, setArmed] = useState(false);
  const [state, action, pending] = useActionState(revokeApiKeyAction, initial);
  if (!armed) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setArmed(true)}>
        {t("revoke")}
      </Button>
    );
  }
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="key_id" value={keyId} />
      <Button variant="ghost" size="sm" onClick={() => setArmed(false)} disabled={pending}>
        {t("cancel")}
      </Button>
      <Button type="submit" size="sm" className="bg-[var(--rust-ink)] hover:bg-[var(--rust-ink)]" disabled={pending}>
        {pending ? t("revoking") : t("confirmRevoke")}
      </Button>
      {state.error ? <span className="text-xs text-[var(--rust-ink)]">{state.error}</span> : null}
    </form>
  );
}

function CopyButton({ value }: { value: string }) {
  const t = useTranslations("settings.apiKeys");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? t("copied") : t("copy")}
    </Button>
  );
}

export function ApiKeysCard({
  keys,
  canManage,
  endpoint,
}: {
  keys: ApiKeyRow[];
  canManage: boolean;
  endpoint: string;
}) {
  const t = useTranslations("settings.apiKeys");
  const locale = useLocale();
  const [state, action, pending] = useActionState(createApiKeyAction, initial);
  // The full key is only ever in the action result: shown once, never persisted client-side.
  const freshKey = state.ok && state.apiKey ? state.apiKey : null;

  const curl = `curl -H "Authorization: Bearer ${freshKey ?? "vs_live_…"}" \\\n  "${endpoint}/orders/1234"`;

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle sub={t("lead")}>{t("title")}</SectionTitle>

      {freshKey ? (
        <div className="rounded-xl border border-[var(--gold-ink)]/30 bg-[var(--gold-soft)] p-4">
          <p className="text-sm font-bold text-[var(--gold-ink)]">{t("newKeyTitle")}</p>
          <p className="mt-0.5 text-xs text-[var(--gold-ink)]">{t("newKeyLead")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-white/70 px-2 py-1 font-mono text-[12px] break-all">{freshKey}</code>
            <CopyButton value={freshKey} />
          </div>
        </div>
      ) : null}

      {keys.length === 0 ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{key.name}</p>
                  <code className="font-mono text-[12px] text-[var(--muted)]">{key.key_prefix}</code>
                  <Badge tone={key.revoked_at ? "grey" : "green"} dot>
                    {key.revoked_at ? t("revoked") : t("active")}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {t("created")} {new Date(key.created_at).toLocaleDateString(locale)} · {t("lastUsed")}{" "}
                  {key.last_used_at ? new Date(key.last_used_at).toLocaleString(locale) : t("never")}
                </p>
              </div>
              {canManage && !key.revoked_at ? <RevokeButton keyId={key.id} /> : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form action={action} className="flex flex-wrap items-end gap-3 border-t border-[var(--line)] pt-4">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-sm">
            <span className="text-[12px] font-semibold text-[var(--muted)]">{t("nameLabel")}</span>
            <input name="name" placeholder={t("namePlaceholder")} autoComplete="off" className="vs-input" />
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? t("creating") : t("create")}
          </Button>
          {state.error ? <span className="text-xs text-[var(--rust-ink)]">{state.error}</span> : null}
        </form>
      ) : (
        <p className="text-xs text-[var(--muted)]">{t("ownerOnly")}</p>
      )}

      <div className="rounded-xl bg-[var(--card-soft)] p-4 text-xs">
        <p className="font-semibold text-[var(--muted)]">{t("endpoint")}</p>
        <code className="mt-1 block font-mono text-[12px] break-all">{endpoint}/orders/{"{order}"}</code>
        <p className="mt-3 font-semibold text-[var(--muted)]">{t("docs")}</p>
        <pre className="mt-1 overflow-x-auto rounded-md bg-white/70 p-2 font-mono text-[11px] leading-relaxed">{curl}</pre>
        <p className="mt-2 text-[var(--muted)]">{t("limit")}</p>
      </div>
    </div>
  );
}
