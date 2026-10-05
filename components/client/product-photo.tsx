export function ProductPhoto({
  src,
  alt,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  if (!src) {
    const initials = alt
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] ?? "")
      .join("")
      .toUpperCase();
    return (
      <div
        aria-hidden
        className={`relative grid place-items-center overflow-hidden bg-[var(--bg-deep)] ${className ?? ""}`}
      >
        <svg
          width="90"
          height="126"
          viewBox="0 0 10 14"
          aria-hidden
          className="absolute -right-2.5 -bottom-6 opacity-[0.12]"
        >
          <path d="M7 0 1 8h3.2L3 14l6-8.2H5.6z" fill="#10284A" />
        </svg>
        <span className="font-display text-[34px] font-extrabold text-[var(--navy)]/85">{initials}</span>
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={`object-cover ${className ?? ""}`} />;
}
