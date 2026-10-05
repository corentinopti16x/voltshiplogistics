"use client";

import { useTranslations } from "next-intl";
import { SOURCING_PIPELINE, type SourcingStatus } from "@/lib/products/types";

export function SourcingPipeline({ step }: { step: SourcingStatus }) {
  const t = useTranslations("products");
  const currentIndex =
    step === "quote_sent"
      ? SOURCING_PIPELINE.indexOf("negotiation")
      : Math.max(0, SOURCING_PIPELINE.indexOf(step));
  const total = SOURCING_PIPELINE.length;
  const inset = 100 / (total * 2);
  const progress = ((100 - 2 * inset) * currentIndex) / (total - 1);

  return (
    <div>
      <p className="mb-4 text-[12px] text-[var(--muted)]">{t("pipeline.caption")}</p>
      <div className="overflow-x-auto">
        <div className="relative min-w-[640px]">
          <span
            aria-hidden
            className="absolute top-[13px] h-[3px] rounded-full bg-[#E9EEF5]"
            style={{ left: `${inset}%`, right: `${inset}%` }}
          />
          <span
            aria-hidden
            className="absolute top-[13px] h-[3px] rounded-full bg-[var(--gold)]"
            style={{ left: `${inset}%`, width: `${progress}%` }}
          />
          <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
            {SOURCING_PIPELINE.map((status, index) => {
              const current = index === currentIndex;
              const done = index < currentIndex;
              return (
                <li key={status} className="flex flex-col items-center gap-2" aria-current={current ? "step" : undefined}>
                  <span
                    className={`box-border grid h-7 w-7 place-items-center rounded-full border-2 ${
                      done
                        ? "border-[var(--gold)] bg-[var(--gold)]"
                        : current
                          ? "border-[var(--gold)] bg-white shadow-[0_0_0_5px_rgba(217,160,58,0.18)]"
                          : "border-[#D4DDE9] bg-white"
                    }`}
                  >
                    {current ? (
                      <svg width="9" height="13" viewBox="0 0 10 14" aria-hidden>
                        <path d="M7 0 1 8h3.2L3 14l6-8.2H5.6z" fill="#10284A" />
                      </svg>
                    ) : null}
                  </span>
                  <span
                    className={`text-center text-[12px] font-semibold ${
                      index <= currentIndex ? "text-[var(--ink)]" : "text-[var(--faint)]"
                    }`}
                  >
                    {t(`pipeline.${status}`)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
