"use client";

import { useEffect, useRef, useState } from "react";

type StatItem = {
  value: string;
  label: string;
  suffix?: string;
};

export function StatsBar({ stats }: { stats: StatItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="grid grid-cols-2 gap-8 sm:grid-cols-4">
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className={`text-center transition-all duration-700 ${
            visible
              ? "translate-y-0 opacity-100"
              : "translate-y-6 opacity-0"
          }`}
          style={{ transitionDelay: `${i * 120}ms` }}
        >
          <p className="stat-glow font-display text-4xl font-semibold tracking-tight text-[#f6f1e7] sm:text-5xl">
            {stat.value}
            {stat.suffix && (
              <span className="text-[var(--gold)]">{stat.suffix}</span>
            )}
          </p>
          <p className="mt-2 text-sm text-[#b7b0a2]">{stat.label}</p>
        </div>
      ))}
    </div>
  );
}
