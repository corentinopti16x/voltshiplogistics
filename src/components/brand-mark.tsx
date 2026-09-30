import { Link } from "@/i18n/routing";

export function BrandMark({
  inverted = false,
  href = "/",
}: {
  inverted?: boolean;
  href?: "/" | "/dashboard" | "/admin" | "/staff/login" | "/sourcer";
}) {
  return (
    <Link href={href} className="flex items-center gap-2.5">
      <span
        aria-hidden
        className={`grid h-8 w-8 place-items-center rounded-md text-[13px] font-semibold tracking-tight ${
          inverted
            ? "bg-[var(--card)] text-[var(--accent)]"
            : "bg-[var(--accent)] text-[var(--card)]"
        }`}
      >
        V
      </span>
      <span
        className={`text-[15px] font-semibold tracking-tight ${
          inverted ? "text-[var(--card)]" : "text-[var(--ink)]"
        }`}
      >
        Voltship
      </span>
    </Link>
  );
}
