import type { ReactNode } from "react";

export function SectionTitle({
  children,
  sub,
  aside,
  as: Tag = "h2",
  size = "md",
}: {
  children: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
  as?: "h2" | "h3";
  size?: "sm" | "md";
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <Tag
          className={`font-display font-bold text-[var(--ink)] ${
            size === "sm" ? "text-[15px]" : "text-[19px]"
          }`}
        >
          {children}
        </Tag>
        {sub ? <p className="mt-0.5 text-[13px] text-[var(--muted)]">{sub}</p> : null}
      </div>
      {aside ? <div className="text-[13px] text-[var(--muted)]">{aside}</div> : null}
    </div>
  );
}

/** White page title rendered on the navy band. */
export function PageTitle({
  kicker,
  title,
  lead,
  actions,
  bandClass = "h-[270px]",
}: {
  kicker?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  /** Height of the navy band behind the header + title (Tailwind height classes). */
  bandClass?: string;
}) {
  return (
    <>
      <PageBand className={bandClass} />
      <div className="flex flex-wrap items-end justify-between gap-4 text-white">
      <div className="min-w-0">
        {kicker ? (
          <p className="text-[13px] font-semibold tracking-[0.03em] text-[var(--gold-bright)]">
            {kicker}
          </p>
        ) : null}
        <h1 className="font-display mt-1 text-[clamp(28px,4vw,42px)] leading-[1.1] font-extrabold tracking-[-0.02em]">
          {title}
        </h1>
        {lead ? <p className="mt-1.5 max-w-2xl text-[15px] text-white/80">{lead}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </>
  );
}

/**
 * Navy band painted behind the shell header and the page title. It is absolutely
 * positioned against the client shell (relative + isolate) and sits below content.
 */
export function PageBand({ className = "h-[270px]" }: { className?: string }) {
  return (
    <div aria-hidden className={`vs-band absolute inset-x-0 top-0 -z-10 overflow-hidden ${className}`}>
      <svg
        className="absolute -top-6 -right-10 hidden opacity-[0.07] md:block"
        width="420"
        height="330"
        viewBox="20 0 760 600"
        aria-hidden
      >
        <path
          fill="#FFFFFF"
          d="M728 351 719 338 711 333 685 324 669 322 527 322 520 324 459 395 458 402 617 404 624 406 627 411 626 420 618 432 608 440 598 444 422 444 362 514 357 522 360 524 619 524 652 515 667 506 680 496 697 475 708 454 732 390 732 362ZM488 246 493 249 576 249 578 252 577 256 561 276 561 280 564 282 696 282 713 285 726 298 732 290 770 198 768 194 765 193 537 193 520 198 512 204 490 239ZM452 127 406 127 384 130 376 134 268 337 262 342 256 339 191 148 183 133 176 131 50 131 33 133 35 138 52 149 69 164 87 190 199 491 207 504 275 505 283 499 364 348 364 342 360 341 302 341 298 339 298 333 321 301 345 273 453 131Z"
        />
        <path fill="#E8B04F" d="M573 16 347 307 411 314 269 588 532 276 455 264Z" />
      </svg>
    </div>
  );
}
