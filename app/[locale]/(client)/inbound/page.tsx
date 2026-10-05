import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { isClientEccangEnabled, listInbound, type InboundRow } from "@/lib/eccang/queries";
import { Badge, Card, EmptyState, PageTitle } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";

const STEPS = ["announced", "arrived", "qc", "stocked"] as const;

/** inbound_cache.status → index on the 4-step rail (annoncé → arrivé → contrôlé → en stock). */
function stepIndex(status: InboundRow["status"]) {
  switch (status) {
    case "stocked":
      return 3;
    case "qc_in_progress":
    case "quarantined":
      return 2;
    case "arrived":
      return 1;
    default:
      return 0;
  }
}

export default async function InboundPage() {
  const [t, locale] = await Promise.all([getTranslations("inbound"), getLocale()]);
  const ctx = await getAuthContext();
  const clientId = ctx?.clientId;

  let rows: InboundRow[] = [];
  let enabled = false;
  if (clientId) {
    try {
      [rows, enabled] = await Promise.all([listInbound(clientId), isClientEccangEnabled(clientId)]);
    } catch {
      rows = [];
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        bandClass="h-[250px]"
        title={t("title")}
        lead={t("lead")}
        actions={
          enabled ? (
            <Badge tone="green" dot>
              {t("live")}
            </Badge>
          ) : null
        }
      />
      <Card as="section" padding="md">
        <div className="grid grid-cols-4 gap-2" aria-hidden>
          {STEPS.map((step, index) => (
            <div key={step} className="flex flex-col gap-2">
              <span
                className={`h-[5px] rounded-full ${index === 0 ? "bg-[var(--gold)]" : "bg-[var(--line-soft)]"}`}
              />
              <span className="text-[12px] font-semibold text-[var(--muted)]">{t(`steps.${step}`)}</span>
            </div>
          ))}
        </div>
        <div className="mt-4">
          {rows.length === 0 ? (
            <EmptyState>{enabled ? t("emptyLive") : t("empty")}</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--line-soft)]">
              {rows.map((row) => {
                const index = stepIndex(row.status);
                const items = Array.isArray(row.items_json) ? row.items_json : [];
                const skus = items.map((item) => item.sku).filter(Boolean);
                const date =
                  row.putaway_at ?? row.received_at ?? row.expected_at ?? (row.eta ? `${row.eta}T00:00:00` : null);
                return (
                  <li key={row.id} className="py-4 first:pt-2 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                          <span className="truncate">{row.reference_no ?? row.eccang_asn_code ?? "—"}</span>
                          {row.cancelled ? (
                            <Badge tone="grey">{t("cancelled")}</Badge>
                          ) : (
                            <Badge tone={index === 3 ? "green" : index === 0 ? "gold" : "blue"}>
                              {t(`steps.${STEPS[index]}`)}
                            </Badge>
                          )}
                        </p>
                        <p className="mt-0.5 text-[12px] text-[var(--muted)]">
                          {row.eccang_asn_code ? `${t("asn")} ${row.eccang_asn_code} · ` : ""}
                          {skus.length > 0 ? `${skus.slice(0, 3).join(", ")}${skus.length > 3 ? "…" : ""} · ` : ""}
                          {t("qty", {
                            announced: formatNumber(row.qty_announced ?? 0, locale),
                            received: formatNumber(row.qty_received ?? 0, locale),
                          })}
                          {row.tracking_no ? ` · ${t("tracking")} ${row.tracking_no}` : ""}
                        </p>
                        {row.product_id ? (
                          <Link
                            href={`/products/${row.product_id}`}
                            className="mt-0.5 inline-block text-[12px] font-semibold text-[var(--blue-ink)] hover:underline"
                          >
                            {t("openProduct")} →
                          </Link>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-[12px] text-[var(--faint)]">
                        {date ? formatDate(date, locale) : formatDate(row.updated_at, locale)}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2" aria-hidden>
                      {STEPS.map((step, stepIndexValue) => (
                        <span
                          key={step}
                          className={`h-[5px] rounded-full ${
                            row.cancelled
                              ? "bg-[var(--line-soft)]"
                              : stepIndexValue <= index
                                ? "bg-[var(--gold)]"
                                : "bg-[var(--line-soft)]"
                          }`}
                        />
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
