import { Link } from "@/i18n/routing";

/**
 * Voltship wordmark: navy "V" tile with a gold bolt, then "VOLTSHIP" + "LOGISTICS".
 * `inverted` renders white type for use on the navy band.
 */
export function BrandMark({
  inverted = false,
  href = "/",
  compact = false,
}: {
  inverted?: boolean;
  href?: "/" | "/dashboard" | "/admin" | "/staff/login" | "/sourcer";
  compact?: boolean;
}) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-2.5" aria-label="Voltship">
      <span
        aria-hidden
        className={`grid h-9 w-9 place-items-center rounded-[10px] ${
          inverted ? "bg-white/12 ring-1 ring-white/20" : "bg-[var(--navy)]"
        }`}
      >
        <svg width="18" height="20" viewBox="0 0 20 22" aria-hidden>
          <path
            d="M0 1h4.6l5.1 12.2L14.8 1H19.4L11.6 21H7.8z"
            fill={inverted ? "#FFFFFF" : "#FFFFFF"}
          />
          <path d="M15.4 0 9.6 8.2h3L11.2 14.5l5.8-8.3h-3z" fill="#E8B04F" />
        </svg>
      </span>
      <span className={`flex flex-col leading-none ${compact ? "sr-only sm:not-sr-only" : ""}`}>
        <span
          className={`font-display text-[15px] font-extrabold tracking-[0.08em] ${
            inverted ? "text-white" : "text-[var(--ink)]"
          }`}
        >
          VOLTSHIP
        </span>
        <span
          className={`mt-0.5 text-[9px] font-semibold tracking-[0.28em] ${
            inverted ? "text-[var(--gold-bright)]" : "text-[var(--gold-text)]"
          }`}
        >
          LOGISTICS
        </span>
      </span>
    </Link>
  );
}
