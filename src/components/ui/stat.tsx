import type { ReactNode } from "react";

export type StatTone = "default" | "gold" | "warning" | "blue" | "muted";

const valueTone: Record<StatTone, string> = {
  default: "text-[var(--ink)]",
  gold: "text-[var(--ink)]",
  warning: "text-[var(--rust-ink)]",
  blue: "text-[var(--ink)]",
  muted: "text-[var(--muted)]",
};

export function Stat({
  label,
  value,
  sub,
  tone = "default",
  size = "lg",
  pill,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: StatTone;
  size?: "sm" | "md" | "lg";
  pill?: ReactNode;
}) {
  const valueSize =
    size === "lg" ? "text-[36px]" : size === "md" ? "text-[26px]" : "text-[18px]";
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-[var(--muted)]">{label}</span>
        {pill}
      </div>
      <span
        className={`font-display tabular mt-1 leading-[1.15] font-extrabold tracking-[-0.02em] ${valueSize} ${valueTone[tone]}`}
      >
        {value}
      </span>
      {sub ? <span className="mt-0.5 text-[12px] text-[var(--faint)]">{sub}</span> : null}
    </div>
  );
}

/** Compact label/value pair for dense grids inside cards. */
export function Metric({
  label,
  value,
  tone = "default",
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: StatTone;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[11px] font-semibold text-[var(--muted)]">{label}</span>
      <span className={`tabular truncate text-[15px] font-bold ${valueTone[tone]}`}>{value}</span>
    </div>
  );
}
