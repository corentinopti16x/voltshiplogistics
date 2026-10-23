import { getTranslations } from "next-intl/server";
import { saveAnnouncedKitPricesAction } from "@/app/actions/announced-prices";
import { KIT_QUANTITIES, parseAnnouncedKits } from "@/lib/domain/pricing";

/**
 * « Prix annoncés — kits » : one row per market × companion product (an upsell of this
 * product), the total promised for this product ×1 + 1 to 6 units of the companion.
 */
export async function AnnouncedKitPricesForm({
  productId,
  quoteJson,
  markets,
  companions,
}: {
  productId: string;
  quoteJson: Record<string, unknown> | null;
  markets: string[];
  companions: Array<{ id: string; title: string }>;
}) {
  if (companions.length === 0) return null;
  const t = await getTranslations("sourcer.announcedKits");
  const kits = parseAnnouncedKits(quoteJson?.announced_kits);
  const rows = [...new Set([...markets, ...Object.keys(kits)])];
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
      <h2 className="text-sm font-semibold">{t("title")}</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">{t("lead")}</p>
      <div className="mt-4 flex flex-col gap-4">
        {rows.flatMap((market) =>
          companions.map((companion) => (
            <form
              key={`${market}:${companion.id}`}
              action={saveAnnouncedKitPricesAction}
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="product_id" value={productId} />
              <input type="hidden" name="market" value={market} />
              <input type="hidden" name="companion_id" value={companion.id} />
              <div className="w-full text-sm">
                <span className="font-semibold">{market}</span>
                <span className="text-[var(--muted)]"> · {t("kitOf", { companion: companion.title })}</span>
              </div>
              {KIT_QUANTITIES.map((quantity) => (
                <label key={quantity} className="flex w-20 flex-col gap-1 text-xs text-[var(--muted)]">
                  1+{quantity}
                  <input
                    name={`q${quantity}`}
                    inputMode="decimal"
                    defaultValue={kits[market]?.[companion.id]?.[String(quantity)] ?? ""}
                    placeholder="—"
                    className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--ink)]"
                  />
                </label>
              ))}
              <button className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-semibold">{t("save")}</button>
            </form>
          )),
        )}
      </div>
    </section>
  );
}
