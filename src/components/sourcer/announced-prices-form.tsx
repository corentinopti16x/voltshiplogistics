import { getTranslations } from "next-intl/server";
import { saveAnnouncedPricesAction } from "@/app/actions/announced-prices";
import { announcedExpired, parseAnnouncedPrices, parseAnnouncedUntil } from "@/lib/domain/pricing";

const QUANTITIES = [1, 2, 3, 4, 5] as const;

/** « Prix annoncés au client » : one row per market, the total promised for 1 to 5 units. */
export async function AnnouncedPricesForm({
  productId,
  quoteJson,
  markets,
}: {
  productId: string;
  quoteJson: Record<string, unknown> | null;
  markets: string[];
}) {
  const t = await getTranslations("sourcer.announced");
  const prices = parseAnnouncedPrices(quoteJson?.announced_prices);
  const until = parseAnnouncedUntil(quoteJson?.announced_until);
  const rows = [...new Set([...markets, ...Object.keys(prices)])];
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
      <h2 className="text-sm font-semibold">{t("title")}</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">{t("lead")}</p>
      <div className="mt-4 flex flex-col gap-3">
        {rows.map((market) => (
          <form key={market} action={saveAnnouncedPricesAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="product_id" value={productId} />
            <input type="hidden" name="market" value={market} />
            <span className="w-10 pb-2 text-sm font-semibold">{market}</span>
            {QUANTITIES.map((quantity) => (
              <label key={quantity} className="flex w-20 flex-col gap-1 text-xs text-[var(--muted)]">
                ×{quantity}
                <input
                  name={`q${quantity}`}
                  inputMode="decimal"
                  defaultValue={prices[market]?.[String(quantity)] ?? ""}
                  placeholder="—"
                  className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--ink)]"
                />
              </label>
            ))}
            <UntilField defaultValue={until[market]} label={t("until")} />
            <button className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-semibold">{t("save")}</button>
            {announcedExpired(until, market) ? (
              <span className="pb-2 text-xs font-semibold text-[#b42318]">{t("expired")}</span>
            ) : null}
          </form>
        ))}
        <form action={saveAnnouncedPricesAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="product_id" value={productId} />
          <label className="flex w-16 flex-col gap-1 text-xs text-[var(--muted)]">
            {t("otherMarket")}
            <input
              name="market"
              maxLength={2}
              placeholder="DE"
              className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-sm uppercase"
            />
          </label>
          {QUANTITIES.map((quantity) => (
            <label key={quantity} className="flex w-20 flex-col gap-1 text-xs text-[var(--muted)]">
              ×{quantity}
              <input
                name={`q${quantity}`}
                inputMode="decimal"
                placeholder="—"
                className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              />
            </label>
          ))}
          <UntilField label={t("until")} />
          <button className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-semibold">{t("save")}</button>
        </form>
      </div>
    </section>
  );
}

function UntilField({ defaultValue, label }: { defaultValue?: string; label: string }) {
  return (
    <label className="flex w-36 flex-col gap-1 text-xs text-[var(--muted)]">
      {label}
      <input
        type="date"
        name="until"
        defaultValue={defaultValue ?? ""}
        className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--ink)]"
      />
    </label>
  );
}
