"use client";

import { useTranslations } from "next-intl";
import { SIMPLE_PIPELINE, simpleStage, type SourcingStatus } from "@/lib/products/types";

export function SourcingPipeline({ step, migrated = false }: { step: SourcingStatus; migrated?: boolean }) {
  const t = useTranslations("products");
  if (migrated) {
    return (
      <p className="text-[14px] font-semibold text-[var(--ink)]">
        <span className="mr-2 text-[#1F7A4D]">✓</span>
        {t("liveNote")}
      </p>
    );
  }
  const currentIndex = SIMPLE_PIPELINE.indexOf(simpleStage(step));
  const total = SIMPLE_PIPELINE.length;
  const inset = 100 / (total * 2);
  const progress = ((100 - 2 * inset) * currentIndex) / (total - 1);

  return (
    <div>
      <p className="mb-4 text-[12px] text-[var(--muted)]">{t("pipeline.caption")}</p>
      <div className="overflow-x-auto">
        <div className="relative min-w-[320px]">
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
            {SIMPLE_PIPELINE.map((status, index) => {
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
                    {t(`simpleStage.${status}`)}
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
