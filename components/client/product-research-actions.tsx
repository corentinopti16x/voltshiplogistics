"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { requestResearchAction } from "@/app/actions/client";
import type { ActionResult } from "@/app/actions/admin";
import {
  RESEARCH_KINDS,
  type ResearchBlock,
  type ResearchKind,
  type ResearchState,
} from "@/lib/products/types";
import {
  canGenerateResearch,
  researchMinimumTier,
} from "@/lib/domain/entitlements";
import type { PlanTier } from "@/lib/auth/types";

const initial: ActionResult = { ok: false };

export function ProductResearchActions({
  productId,
  research,
  showPack,
  planTier,
}: {
  productId: string;
  research: ResearchState;
  showPack: boolean;
  planTier: PlanTier;
}) {
  const t = useTranslations("products.research");
  const router = useRouter();
  const [state, action, pending] = useActionState(requestResearchAction, initial);
  const allowedKinds = RESEARCH_KINDS.filter((kind) => canGenerateResearch(planTier, kind));
  const allReady = allowedKinds.every((kind) => research[kind].status === "ready");
  const isGenerating = RESEARCH_KINDS.some(
    (kind) => research[kind].status === "generating",
  );

  useEffect(() => {
    if (!isGenerating) return;
    const interval = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [isGenerating, router]);

  return (
    <div className="mt-4 space-y-4">
      {showPack ? (
        <form action={action}>
          <input type="hidden" name="product_id" value={productId} />
          <input type="hidden" name="kinds" value={allowedKinds.join(",")} />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex cursor-pointer items-center justify-center rounded-[10px] bg-[var(--navy)] px-4 py-2.5 text-[14px] font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? t("generating") : allReady ? t("refreshPack") : t("generatePack")}
          </button>
        </form>
      ) : null}

      <ul className="space-y-3">
        {RESEARCH_KINDS.map((kind) => (
          <ResearchRow
            key={kind}
            productId={productId}
            kind={kind}
            block={research[kind]}
            pending={pending}
            action={action}
            label={t(kind)}
            generate={t("generate")}
            refresh={t("refresh")}
            generating={t("generating")}
            statusLabel={t(`status.${research[kind].status === "ready" ? "ready" : "not_generated"}`)}
            readyOn={t("readyOn")}
            locked={!canGenerateResearch(planTier, kind)}
            lockedLabel={t("locked", { tier: researchMinimumTier(kind) })}
            openLabel={t("open")}
          />
        ))}
      </ul>

      {state.error ? (
        <p className="text-sm text-[var(--rust-ink)]" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.ok ? <p className="text-sm text-[var(--green-ink)]">{t("ready")}</p> : null}
    </div>
  );
}

function ResearchRow({
  productId,
  kind,
  block,
  pending,
  action,
  label,
  generate,
  refresh,
  generating,
  statusLabel,
  readyOn,
  locked,
  lockedLabel,
  openLabel,
}: {
  productId: string;
  kind: ResearchKind;
  block: ResearchBlock;
  pending: boolean;
  action: (formData: FormData) => void;
  label: string;
  generate: string;
  refresh: string;
  generating: string;
  statusLabel: string;
  readyOn: string;
  locked: boolean;
  lockedLabel: string;
  openLabel: string;
}) {
  const ready = block.status === "ready";

  return (
    <li className="rounded-[14px] border border-[var(--line-soft)] bg-[var(--card-soft)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-[var(--muted)]">
            {locked
              ? lockedLabel
              : ready && block.ready_at
              ? `${readyOn} ${new Date(block.ready_at).toLocaleDateString()}`
              : statusLabel}
          </p>
        </div>
        <form action={action}>
          <input type="hidden" name="product_id" value={productId} />
          <input type="hidden" name="kinds" value={kind} />
          <button
            type="submit"
            disabled={pending || locked}
            className="inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-[#d4dde9] bg-[var(--card)] px-3 py-1.5 text-[13px] font-semibold text-[var(--ink)] transition hover:border-[var(--navy)] hover:bg-[var(--card-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? generating : ready ? refresh : generate}
          </button>
        </form>
      </div>

      {ready ? (
        <div className="mt-3 space-y-2 text-sm">
          {block.title ? <p className="font-medium">{block.title}</p> : null}
          {block.summary ? (
            <p className="text-[var(--muted)]">{block.summary}</p>
          ) : null}
          {block.bullets && block.bullets.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-[var(--ink)]">
              {block.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {block.cards && block.cards.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-3">
              {block.cards.map((card) => (
                <article
                  key={card.name}
                  className="rounded-[10px] bg-[var(--card-soft)] px-3 py-2"
                >
                  <p className="font-medium">{card.name}</p>
                  <p className="text-xs text-[var(--muted)]">{card.role}</p>
                  <p className="mt-2 text-xs">{card.need}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{card.hook}</p>
                </article>
              ))}
            </div>
          ) : null}
          {block.url ? (
            <a
              href={block.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-sm font-semibold text-[var(--blue-ink)] underline"
            >
              {openLabel}
            </a>
          ) : null}
        </div>
      ) : null}
      {block.error ? <p className="mt-3 text-sm text-[var(--rust-ink)]">{block.error}</p> : null}
    </li>
  );
}
