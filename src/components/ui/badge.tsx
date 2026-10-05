import type { ReactNode } from "react";

export type BadgeTone = "navy" | "gold" | "blue" | "rust" | "grey" | "green" | "outline";

const tones: Record<BadgeTone, string> = {
  navy: "bg-[var(--navy)] text-white",
  gold: "bg-[var(--gold-soft)] text-[var(--gold-ink)]",
  blue: "bg-[var(--blue-soft)] text-[var(--blue-ink)]",
  rust: "bg-[var(--rust-soft)] text-[var(--rust-ink)]",
  grey: "bg-[var(--grey-soft)] text-[var(--muted)]",
  green: "bg-[var(--green-soft)] text-[var(--green-ink)]",
  outline: "border border-[var(--line)] bg-[var(--card)] text-[var(--muted)]",
};

export function Badge({
  tone = "grey",
  children,
  className = "",
  dot = false,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[7px] px-2 py-0.5 text-[11px] font-bold tracking-[0.02em] whitespace-nowrap ${tones[tone]} ${className}`}
    >
      {dot ? <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export function CountPill({ children, tone = "gold" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span
      className={`inline-flex min-w-[22px] items-center justify-center rounded-full px-2 py-0.5 text-[12px] font-bold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
