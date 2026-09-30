"use client";

import { useTranslations } from "next-intl";
import { SOURCING_PIPELINE, type SourcingStatus } from "@/lib/products/types";

export function SourcingPipeline({
  step,
}: {
  step: SourcingStatus;
}) {
  const t = useTranslations("products");
  const currentIndex = Math.max(0, SOURCING_PIPELINE.indexOf(step));

  return (
    <div className="mt-6">
      <p className="mb-2 text-xs text-[var(--muted)]">{t("pipeline.caption")}</p>
      <ol className="flex flex-wrap items-center gap-2">
        {SOURCING_PIPELINE.map((status, index) => {
          const current = status === step || (step === "quote_sent" && status === "negotiation");
          const done = index < currentIndex;
          return (
            <li key={status} className="flex items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-[11px] ${
                  current
                    ? "bg-[var(--accent)] text-white"
                    : done
                      ? "bg-[var(--card)] text-[var(--ink)] ring-1 ring-[var(--accent)]"
                      : "bg-[var(--card)] text-[var(--muted)] ring-1 ring-[var(--line)]"
                }`}
              >
                {t(`pipeline.${status}`)}
              </span>
              {index < SOURCING_PIPELINE.length - 1 ? (
                <span aria-hidden className="text-[var(--line)]">
                  →
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
