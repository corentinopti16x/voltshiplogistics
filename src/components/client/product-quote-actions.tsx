"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { acceptQuoteAction, askQuoteQuestionAction } from "@/app/actions/client";
import type { ActionResult } from "@/app/actions/admin";
import type { ProductQuestion } from "@/lib/products/types";

const initial: ActionResult = { ok: false };

export function ProductQuoteActions({
  productId,
  ready,
  accepted,
  questions,
}: {
  productId: string;
  ready: boolean;
  accepted: boolean;
  questions: ProductQuestion[];
}) {
  const t = useTranslations("products.quote");
  const [acceptState, acceptAction, accepting] = useActionState(acceptQuoteAction, initial);
  const [questionState, questionAction, asking] = useActionState(askQuoteQuestionAction, initial);

  return (
    <div className="mt-5 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {accepted ? (
          <p className="text-sm text-[var(--green-ink)]">{t("accepted")}</p>
        ) : (
          <form action={acceptAction}>
            <input type="hidden" name="product_id" value={productId} />
            <button
              type="submit"
              disabled={!ready || accepting}
              className="inline-flex cursor-pointer items-center justify-center rounded-[10px] bg-[var(--navy)] px-4 py-2.5 text-[14px] font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {accepting ? t("accepting") : t("accept")}
            </button>
          </form>
        )}
        {!ready && !accepted ? (
          <p className="text-xs text-[var(--muted)]">{t("acceptHint")}</p>
        ) : null}
      </div>
      {acceptState.error ? (
        <p className="text-sm text-[var(--rust-ink)]" role="alert">
          {acceptState.error}
        </p>
      ) : null}

      <form action={questionAction} className="space-y-2">
        <input type="hidden" name="product_id" value={productId} />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[12px] font-semibold text-[var(--muted)]">{t("questionLabel")}</span>
          <textarea
            name="question"
            rows={3}
            required
            minLength={2}
            placeholder={t("questionPlaceholder")}
            className="vs-input"
          />
        </label>
        {questionState.error ? (
          <p className="text-sm text-[var(--rust-ink)]" role="alert">
            {questionState.error}
          </p>
        ) : null}
        {questionState.ok ? <p className="text-sm text-[var(--green-ink)]">{t("questionSent")}</p> : null}
        <button
          type="submit"
          disabled={asking}
          className="inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-[#d4dde9] bg-[var(--card)] px-4 py-2.5 text-[14px] font-semibold text-[var(--ink)] transition hover:border-[var(--navy)] hover:bg-[var(--card-soft)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {asking ? t("sending") : t("question")}
        </button>
      </form>

      {questions.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {questions.map((item) => (
            <li key={`${item.at}-${item.text}`} className="rounded-[10px] bg-[var(--card-soft)] px-3 py-2">
              <p>{item.text}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {new Date(item.at).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
