"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Small accessible carousel over hot-linked Shopify images (no copy is stored).
 * Prev/next are real buttons with aria-labels; dots jump to a slide.
 */
export function ProductImageCarousel({
  images,
  alt,
  className = "",
  compact = false,
}: {
  images: string[];
  alt: string;
  className?: string;
  compact?: boolean;
}) {
  const t = useTranslations("products.carousel");
  const [index, setIndex] = useState(0);
  const count = images.length;
  if (count === 0) return null;
  const current = Math.min(index, count - 1);
  const go = (next: number) => setIndex((next + count) % count);
  const stop = (event: React.SyntheticEvent) => {
    // The card is wrapped in a link: keep clicks on the controls local.
    event.preventDefault();
    event.stopPropagation();
  };
  // z-[2]: stays clickable above a stretched card link (z-[1]).
  const buttonClass = `absolute top-1/2 z-[2] grid -translate-y-1/2 place-items-center rounded-full bg-white/90 text-[var(--navy)] shadow-[0_1px_3px_rgba(16,40,74,0.25)] ring-1 ring-[var(--line-soft)] hover:bg-white ${
    compact ? "h-7 w-7 text-[14px]" : "h-9 w-9 text-[18px]"
  }`;

  return (
    <div
      className={`relative overflow-hidden bg-[var(--bg-deep)] ${className}`}
      role="group"
      aria-roledescription="carousel"
      aria-label={t("label", { title: alt })}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={images[current]}
        alt={count > 1 ? t("slideAlt", { title: alt, index: current + 1, count }) : alt}
        className="h-full w-full object-cover"
        loading="lazy"
      />
      {count > 1 ? (
        <>
          <button
            type="button"
            className={`${buttonClass} left-1.5`}
            aria-label={t("prev")}
            onClick={(event) => {
              stop(event);
              go(current - 1);
            }}
          >
            <span aria-hidden>‹</span>
          </button>
          <button
            type="button"
            className={`${buttonClass} right-1.5`}
            aria-label={t("next")}
            onClick={(event) => {
              stop(event);
              go(current + 1);
            }}
          >
            <span aria-hidden>›</span>
          </button>
          <div
            className="absolute inset-x-0 bottom-1.5 z-[2] flex justify-center gap-1.5"
            role="tablist"
            aria-label={t("dots")}
          >
            {images.map((src, dot) => (
              <button
                key={`${src}-${dot}`}
                type="button"
                role="tab"
                aria-selected={dot === current}
                aria-label={t("goTo", { index: dot + 1, count })}
                className={`h-2 rounded-full ring-1 ring-black/10 transition ${
                  dot === current ? "w-4 bg-[var(--gold-bright)]" : "w-2 bg-white/85 hover:bg-white"
                }`}
                onClick={(event) => {
                  stop(event);
                  go(dot);
                }}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
