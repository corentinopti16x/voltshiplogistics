import type { ComponentProps, ReactNode } from "react";
import { Link } from "@/i18n/routing";

export type ButtonVariant = "primary" | "gold" | "secondary" | "ghost" | "link";
export type ButtonSize = "sm" | "md";

const base =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-[10px] font-semibold whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-[var(--navy)] text-white hover:bg-[var(--accent-hover)]",
  gold: "bg-[var(--gold-bright)] text-[var(--navy)] hover:bg-[#f0bb5a]",
  secondary:
    "border border-[#d4dde9] bg-[var(--card)] text-[var(--ink)] hover:border-[var(--navy)] hover:bg-[var(--card-soft)]",
  ghost: "text-[var(--muted)] hover:bg-[var(--card-soft)] hover:text-[var(--ink)]",
  link: "rounded-none px-0 text-[var(--blue-ink)] hover:underline",
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-[13px]",
  md: "px-4 py-2.5 text-[14px]",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = "") {
  return `${base} ${variants[variant]} ${variant === "link" ? "" : sizes[size]} ${extra}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
} & ComponentProps<"button">) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  href,
  children,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  href: ComponentProps<typeof Link>["href"];
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

/** Small lightning glyph used as the brand motif. */
export function Bolt({ className = "", fill = "currentColor" }: { className?: string; fill?: string }) {
  return (
    <svg width="9" height="13" viewBox="0 0 10 14" aria-hidden className={className}>
      <path d="M7 0 1 8h3.2L3 14l6-8.2H5.6z" fill={fill} />
    </svg>
  );
}
