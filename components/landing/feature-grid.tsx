import type { ReactElement } from "react";

const featureIcons: Record<string, ReactElement> = {
  library: (
    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  quote: (
    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  stock: (
    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 16l4-4 4 4 5-5" />
    </svg>
  ),
  research: (
    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.3-4.3" />
      <path d="M11 8v6M8 11h6" />
    </svg>
  ),
  economics: (
    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  ),
  notifications: (
    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
};

type FeatureItem = {
  key: string;
  title: string;
  body: string;
};

export function FeatureGrid({ features }: { features: FeatureItem[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {features.map((feature) => (
        <article
          key={feature.key}
          className="feature-card group rounded-2xl border border-[var(--line)] bg-[var(--card)] p-7"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--card)] transition-colors group-hover:bg-[var(--gold)] group-hover:text-[var(--forest)]">
            {featureIcons[feature.key] ?? featureIcons.library}
          </div>
          <h3 className="mt-5 text-lg font-semibold tracking-tight">
            {feature.title}
          </h3>
          <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">
            {feature.body}
          </p>
        </article>
      ))}
    </div>
  );
}
