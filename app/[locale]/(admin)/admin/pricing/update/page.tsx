import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAssistantConfigured } from "@/lib/ai/anthropic";
import {
  buildRateImportReview,
  getRateImport,
  readOverrides,
  type RateImportStatus,
} from "@/lib/pricing/ai-import-server";
import { RateImportStart } from "@/components/admin/rate-import-start";
import { RateImportReviewPanel } from "@/components/admin/rate-import-review";
import { Badge, Card } from "@/components/ui";
import { formatDate } from "@/lib/format";

const statusTone: Record<RateImportStatus, "grey" | "blue" | "green" | "outline"> = {
  draft: "grey",
  reviewed: "blue",
  activated: "green",
  discarded: "outline",
};

export default async function AdminPricingUpdatePage({
  searchParams,
}: {
  searchParams: Promise<{ import?: string }>;
}) {
  const [{ import: importId }, t, locale] = await Promise.all([
    searchParams,
    getTranslations("admin.rateImport"),
    getLocale(),
  ]);

  const row = importId ? await getRateImport(importId) : null;
  const review = row ? await buildRateImportReview(row, readOverrides(row.summary_json)) : null;

  const admin = createAdminClient();
  const { data: recent } = review
    ? { data: [] }
    : await admin
        .from("rate_grid_imports")
        .select("id, status, carrier, destination_hint, grid_version, created_at")
        .order("created_at", { ascending: false })
        .limit(12);

  return (
    <div>
      <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">
        {t("kicker")}
      </p>
      <h1 className="font-display mt-2 text-3xl">{t("title")}</h1>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">{t("lead")}</p>
      <p className="mt-2 text-sm">
        <Link href="/admin/pricing" className="font-semibold text-[var(--blue-ink)] hover:underline">
          ← {t("backToPricing")}
        </Link>
      </p>

      <div className="mt-8">
        {review ? (
          <RateImportReviewPanel initial={review} />
        ) : (
          <div className="flex flex-col gap-5">
            <Card as="section" padding="md">
              <h2 className="font-display text-[19px] font-bold">{t("step1.title")}</h2>
              <p className="mt-0.5 mb-4 text-[13px] text-[var(--muted)]">{t("step1.lead")}</p>
              <RateImportStart configured={isAssistantConfigured()} />
            </Card>

            <Card as="section" padding="md">
              <h2 className="font-display text-[15px] font-bold">{t("step1.recent")}</h2>
              {(recent ?? []).length === 0 ? (
                <p className="mt-3 text-sm text-[var(--muted)]">{t("step1.none")}</p>
              ) : (
                <ul className="mt-3 divide-y divide-[var(--line)]">
                  {(recent ?? []).map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge tone={statusTone[item.status as RateImportStatus] ?? "grey"}>
                          {t(`step1.status.${item.status as RateImportStatus}`)}
                        </Badge>
                        <span className="font-semibold">{item.carrier ?? "—"}</span>
                        {item.destination_hint ? (
                          <span className="text-[var(--muted)]">· {item.destination_hint}</span>
                        ) : null}
                        {item.grid_version ? (
                          <span className="text-[var(--muted)]">· {item.grid_version}</span>
                        ) : null}
                        <span className="text-[12px] text-[var(--faint)]">
                          {formatDate(item.created_at, locale, true)}
                        </span>
                      </div>
                      <Link
                        href={{ pathname: "/admin/pricing/update", query: { import: item.id } }}
                        className="font-semibold text-[var(--blue-ink)] hover:underline"
                      >
                        {t("step1.open")}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
