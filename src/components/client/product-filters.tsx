"use client";

import { useTranslations } from "next-intl";
import type { LifecycleStatus, SourcingStatus } from "@/lib/products/types";

export function ProductFilters({
  q,
  lifecycle,
  sourcing,
}: {
  q: string;
  lifecycle: string;
  sourcing: string;
}) {
  const t = useTranslations("products");

  return (
    <form className="mt-6 grid gap-3 sm:grid-cols-4" method="get">
      <input
        name="q"
        defaultValue={q}
        placeholder={t("search")}
        className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
      />
      <select
        name="lifecycle"
        defaultValue={lifecycle}
        className="cursor-pointer rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm capitalize"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">{t("allLifecycle")}</option>
        {(["testing", "winning", "declining", "dead"] as LifecycleStatus[]).map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <select
        name="sourcing"
        defaultValue={sourcing}
        className="cursor-pointer rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">{t("allSourcing")}</option>
        {(
          [
            "brief_received",
            "factories",
            "samples",
            "negotiation",
            "quote_sent",
            "validated",
            "in_production",
            "in_stock",
            "flagged",
          ] as SourcingStatus[]
        ).map((status) => (
          <option key={status} value={status}>
            {status.replaceAll("_", " ")}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="cursor-pointer rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm hover:bg-[var(--card)]"
      >
        {t("applyFilters")}
      </button>
    </form>
  );
}
