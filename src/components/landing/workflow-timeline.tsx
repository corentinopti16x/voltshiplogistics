"use client";

import { useEffect, useRef, useState } from "react";

type Step = {
  num: string;
  title: string;
  body: string;
};

export function WorkflowTimeline({ steps }: { steps: Step[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { threshold: 0.2 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="relative">
      {/* Vertical line */}
      <div
        className="absolute top-0 left-[23px] hidden h-full w-px bg-gradient-to-b from-[var(--gold)] via-[var(--line)] to-transparent lg:block"
        aria-hidden
      />

      <div className="grid gap-8 lg:gap-0">
        {steps.map((step, i) => (
          <div
            key={step.num}
            className={`relative flex gap-6 lg:gap-8 lg:py-6 transition-all duration-700 ${
              visible
                ? "translate-y-0 opacity-100"
                : "translate-y-8 opacity-0"
            }`}
            style={{ transitionDelay: `${i * 150}ms` }}
          >
            {/* Number circle */}
            <div className="relative z-10 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-2 border-[var(--gold)] bg-[var(--card)] text-sm font-bold text-[var(--gold)]">
              {step.num}
            </div>

            {/* Content */}
            <div className="pt-1.5">
              <h3 className="text-lg font-semibold tracking-tight">
                {step.title}
              </h3>
              <p className="mt-1.5 max-w-md text-[15px] leading-relaxed text-[var(--muted)]">
                {step.body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
