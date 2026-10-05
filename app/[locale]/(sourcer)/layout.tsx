import type { ReactNode } from "react";

// Sourcer pages always need live DB data — never pre-render at build time.
export const dynamic = "force-dynamic";

export default function SourcerLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
