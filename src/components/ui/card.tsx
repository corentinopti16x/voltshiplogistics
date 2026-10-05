import type { ComponentProps, ReactNode } from "react";

type Padding = "none" | "sm" | "md" | "lg";

const paddings: Record<Padding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-7",
};

export function Card({
  as: Tag = "div",
  padding = "md",
  hover = false,
  className = "",
  children,
  id,
  ...rest
}: {
  as?: "div" | "section" | "article";
  padding?: Padding;
  hover?: boolean;
  className?: string;
  children: ReactNode;
  id?: string;
} & Pick<ComponentProps<"div">, "aria-label" | "aria-labelledby" | "role">) {
  return (
    <Tag
      id={id}
      className={`vs-card min-w-0 ${hover ? "vs-card-hover" : ""} ${paddings[padding]} ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 ${className}`}>
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--card-soft)] px-4 py-5 text-sm text-[var(--muted)]">
      {children}
    </p>
  );
}
