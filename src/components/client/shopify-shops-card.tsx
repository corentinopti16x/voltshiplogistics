"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { disconnectShopAction } from "@/app/actions/client";
import type { ActionResult } from "@/app/actions/admin";
import { Badge, Button, EmptyState, SectionTitle, buttonClass, type BadgeTone } from "@/components/ui";

export type ShopRow = {
  id: string;
  shopify_domain: string;
  status: "pending" | "active" | "disconnected";
  last_synced_at: string | null;
  sync_error: string | null;
};

const initial: ActionResult = { ok: false };

const statusTone: Record<ShopRow["status"], BadgeTone> = {
  active: "green",
  pending: "gold",
  disconnected: "grey",
};

function DisconnectButton({ shopId }: { shopId: string }) {
  const t = useTranslations("settings.shopify");
  const [armed, setArmed] = useState(false);
  const [state, action, pending] = useActionState(disconnectShopAction, initial);

  if (!armed) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setArmed(true)}>
        {t("disconnect")}
      </Button>
    );
  }
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="shop_id" value={shopId} />
      <Button variant="ghost" size="sm" onClick={() => setArmed(false)} disabled={pending}>
        {t("cancel")}
      </Button>
      <Button
        type="submit"
        size="sm"
        className="bg-[var(--rust-ink)] hover:bg-[var(--rust-ink)]"
        disabled={pending}
      >
        {pending ? t("disconnecting") : t("confirmDisconnect")}
      </Button>
      {state.error ? <span className="text-xs text-[var(--rust-ink)]">{state.error}</span> : null}
    </form>
  );
}

export function ShopifyShopsCard({
  shops,
  canConnect,
  connected,
  error,
}: {
  shops: ShopRow[];
  canConnect: boolean;
  connected: boolean;
  error: string | null;
}) {
  const t = useTranslations("settings.shopify");
  const locale = useLocale();

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle sub={t("lead")}>{t("title")}</SectionTitle>

      {connected ? (
        <p className="rounded-[10px] bg-[var(--green-soft)] px-3 py-2 text-sm text-[var(--green-ink)]">
          {t("connectedBanner")}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-[10px] bg-[var(--rust-soft)] px-3 py-2 text-sm text-[var(--rust-ink)]">
          {error}
        </p>
      ) : null}

      {shops.length === 0 ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {shops.map((shop) => (
            <li
              key={shop.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{shop.shopify_domain}</p>
                  <Badge tone={statusTone[shop.status]} dot>
                    {t(`status.${shop.status}`)}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {t("lastSync")}{" "}
                  {shop.last_synced_at
                    ? new Date(shop.last_synced_at).toLocaleString(locale)
                    : t("never")}
                </p>
                {shop.sync_error ? (
                  <p className="mt-1 text-xs text-[var(--rust-ink)]">{shop.sync_error}</p>
                ) : null}
              </div>
              {canConnect && shop.status !== "disconnected" ? (
                <DisconnectButton shopId={shop.id} />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canConnect ? (
        <form
          method="get"
          action="/api/shopify/connect"
          className="flex flex-col gap-3 border-t border-[var(--line)] pt-4"
        >
          <input type="hidden" name="from" value="client" />
          <input type="hidden" name="locale" value={locale} />
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[12px] font-semibold text-[var(--muted)]">{t("domainLabel")}</span>
            <input
              name="shop"
              required
              placeholder="monstore.myshopify.com"
              autoComplete="off"
              className="vs-input"
            />
          </label>
          <p className="text-xs text-[var(--muted)]">{t("access")}</p>
          <button type="submit" className={buttonClass("primary", "md", "self-start")}>
            {t("connect")}
          </button>
        </form>
      ) : (
        <p className="text-xs text-[var(--muted)]">{t("ownerOnly")}</p>
      )}
    </div>
  );
}
