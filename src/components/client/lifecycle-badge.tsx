import type { LifecycleStatus, SourcingStatus } from "@/lib/products/types";

const lifecycleClass: Record<LifecycleStatus, string> = {
  testing: "bg-[#d5e4f4] text-[#1d3b5c]",
  winning: "bg-[#ead9a3] text-[#5a4a18]",
  declining: "bg-[#f0d3b8] text-[#6a3b14]",
  dead: "bg-[#e4e2dc] text-[#555248]",
  archived: "bg-[#eeeae3] text-[#6a6558]",
};

export function LifecycleBadge({ status }: { status: LifecycleStatus | null }) {
  if (!status) return null;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${lifecycleClass[status]}`}
    >
      {status}
    </span>
  );
}

export function SourcingLabel({ status }: { status: SourcingStatus | null }) {
  if (!status) return null;
  return (
    <span className="text-[11px] text-[var(--muted)]">
      {status.replaceAll("_", " ")}
    </span>
  );
}
