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
    return (
      <div
        className={`grid place-items-center bg-[#e8e1d4] text-xs text-[var(--muted)] ${className ?? ""}`}
      >
        {alt.slice(0, 1).toUpperCase()}
      </div>
    );
  }

  return <img src={src} alt={alt} className={`object-cover ${className ?? ""}`} />;
}
