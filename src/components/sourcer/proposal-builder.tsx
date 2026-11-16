"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { buildProposalAction, type ProposalProduct } from "@/app/actions/proposal";
import { PRICING_TIERS, PRICING_TIER_LABELS, type PricingTier } from "@/lib/domain/pricing-tiers";
import { TRANSPORT_CHANNELS } from "@/lib/pricing/transport-view";
import { PROPOSAL_MAX_ITEMS, PROPOSAL_MAX_MARKETS, PROPOSAL_QUANTITIES } from "@/lib/proposal/core";

type Line = {
  key: number;
  name: string;
  price: string;
  currency: "rmb" | "eur";
  weightG: string;
  channel: string;
  photo: string | null;
};

const PHOTO_MAX_PX = 640;

/** Photo picked on the computer, shrunk in the browser: it never leaves the page. */
function readPhoto(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => resolve(null);
      image.onload = () => {
        const scale = Math.min(1, PHOTO_MAX_PX / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) return resolve(null);
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

const field =
  "mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--navy)]";

export function ProposalBuilder({ countries }: { countries: string[] }) {
  const t = useTranslations("sourcer.proposal");
  const locale = useLocale();
  const [prospect, setProspect] = useState("");
  const [tier, setTier] = useState<PricingTier>("gold");
  const [markets, setMarkets] = useState<string[]>(countries.includes("FR") ? ["FR"] : []);
  const [note, setNote] = useState("");
  const [detail, setDetail] = useState(true);
  const [lines, setLines] = useState<Line[]>([
    { key: 1, name: "", price: "", currency: "rmb", weightG: "", channel: "standard", photo: null },
  ]);
  const [result, setResult] = useState<{ products: ProposalProduct[]; photos: (string | null)[]; date: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const countryName = (code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  const money = (value: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(value);
  const patch = (key: number, change: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));
  const toggleMarket = (code: string) =>
    setMarkets((current) =>
      current.includes(code)
        ? current.filter((item) => item !== code)
        : current.length >= PROPOSAL_MAX_MARKETS
          ? current
          : [...current, code],
    );

  const ready = (line: Line) => line.name.trim() && line.price.trim() && line.weightG.trim();

  function calculate() {
    const usable = lines.filter(ready);
    setError(null);
    if (usable.length === 0) return setError(t("errors.empty"));
    if (markets.length === 0) return setError(t("errors.markets"));
    startTransition(async () => {
      const response = await buildProposalAction({
        tier,
        markets,
        items: usable.map(({ name, price, currency, weightG, channel }) => ({ name, price, currency, weightG, channel })),
      });
      if (!response.ok) {
        setResult(null);
        setError(t(`errors.${response.error}`));
        return;
      }
      setResult({
        products: response.products,
        photos: usable.map((line) => line.photo),
        date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date()),
      });
    });
  }

  return (
    <div className="space-y-8">
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #proposal-doc, #proposal-doc * { visibility: visible !important; }
        #proposal-doc { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; border: 0; box-shadow: none; }
        #proposal-doc section { break-inside: avoid; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @page { margin: 14mm; }
      }`}</style>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-[var(--muted)]">{t("prospect")}</span>
            <input className={field} value={prospect} onChange={(event) => setProspect(event.target.value)} placeholder={t("prospectHint")} />
          </label>
          <label className="text-sm">
            <span className="text-[var(--muted)]">{t("tier")}</span>
            <select className={field} value={tier} onChange={(event) => setTier(event.target.value as PricingTier)}>
              {[...PRICING_TIERS].reverse().map((value) => (
                <option key={value} value={value}>
                  {PRICING_TIER_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="mt-5 text-sm text-[var(--muted)]">{t("markets", { max: PROPOSAL_MAX_MARKETS })}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {countries.map((code) => {
            const selected = markets.includes(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() => toggleMarket(code)}
                aria-pressed={selected}
                className={`rounded-full px-3 py-1 text-sm ${selected ? "bg-[var(--navy)] text-white" : "text-[var(--muted)] ring-1 ring-[var(--line)] hover:text-[var(--ink)]"}`}
              >
                {countryName(code)}
              </button>
            );
          })}
        </div>

        <h2 className="mt-7 text-sm font-semibold">{t("products")}</h2>
        <div className="mt-3 space-y-3">
          {lines.map((line) => (
            <div key={line.key} className="grid items-end gap-3 rounded-xl border border-[var(--line)] p-3 sm:grid-cols-[84px_1.6fr_1.2fr_0.8fr_1.1fr_auto]">
              <label className="block cursor-pointer text-center text-xs text-[var(--muted)]">
                <span className="grid h-[72px] w-[84px] place-items-center overflow-hidden rounded-lg border border-dashed border-[var(--line)] bg-white">
                  {line.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local data URL, never uploaded
                    <img src={line.photo} alt="" className="h-full w-full object-cover" />
                  ) : (
                    t("photo")
                  )}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (file) patch(line.key, { photo: await readPhoto(file) });
                  }}
                />
              </label>
              <label className="text-sm">
                <span className="text-[var(--muted)]">{t("name")}</span>
                <input className={field} value={line.name} onChange={(event) => patch(line.key, { name: event.target.value })} />
              </label>
              <label className="text-sm">
                <span className="text-[var(--muted)]">{t("price")}</span>
                <span className="mt-1 flex gap-1">
                  <input className={`${field} mt-0`} inputMode="decimal" value={line.price} onChange={(event) => patch(line.key, { price: event.target.value })} />
                  <select
                    className={`${field} mt-0 w-auto`}
                    value={line.currency}
                    aria-label={t("currency")}
                    onChange={(event) => patch(line.key, { currency: event.target.value as Line["currency"] })}
                  >
                    <option value="rmb">¥</option>
                    <option value="eur">€</option>
                  </select>
                </span>
              </label>
              <label className="text-sm">
                <span className="text-[var(--muted)]">{t("weight")}</span>
                <input className={field} inputMode="numeric" value={line.weightG} onChange={(event) => patch(line.key, { weightG: event.target.value })} />
              </label>
              <label className="text-sm">
                <span className="text-[var(--muted)]">{t("type")}</span>
                <select className={field} value={line.channel} onChange={(event) => patch(line.key, { channel: event.target.value })}>
                  {TRANSPORT_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {t(`channels.${channel}`)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="pb-2 text-sm text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-40"
                disabled={lines.length === 1}
                onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
              >
                {t("remove")}
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mt-3 text-sm font-medium underline disabled:opacity-40"
          disabled={lines.length >= PROPOSAL_MAX_ITEMS}
          onClick={() =>
            setLines((current) => [
              ...current,
              { key: Math.max(...current.map((item) => item.key)) + 1, name: "", price: "", currency: "rmb", weightG: "", channel: "standard", photo: null },
            ])
          }
        >
          {t("add")}
        </button>

        <label className="mt-6 block text-sm">
          <span className="text-[var(--muted)]">{t("note")}</span>
          <textarea className={field} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("noteHint")} />
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={detail} onChange={(event) => setDetail(event.target.checked)} />
          {t("detail")}
        </label>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={calculate}
            disabled={pending}
            className="rounded-full bg-[var(--navy)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? t("calculating") : t("calculate")}
          </button>
          {result ? (
            <button type="button" onClick={() => window.print()} className="rounded-full px-5 py-2 text-sm font-semibold ring-1 ring-[var(--line)]">
              {t("pdf")}
            </button>
          ) : null}
          {error ? <p className="text-sm text-[var(--rust-ink)]">{error}</p> : null}
        </div>
        {result ? <p className="mt-3 text-xs text-[var(--muted)]">{t("pdfHint")}</p> : null}
      </div>

      {result ? (
        <article id="proposal-doc" className="rounded-2xl border border-[var(--line)] bg-white p-8 text-[#14213d]">
          <header className="flex items-start justify-between gap-6 border-b border-[#d9dee8] pb-5">
            <div>
              <p className="text-lg font-extrabold tracking-wide">VOLTSHIP LOGISTICS</p>
              <h2 className="mt-3 text-2xl font-semibold">{t("doc.title")}</h2>
              {prospect.trim() ? <p className="mt-1 text-sm">{t("doc.for", { name: prospect.trim() })}</p> : null}
            </div>
            <p className="text-right text-sm text-[#5b6577]">{result.date}</p>
          </header>

          {result.products.map((product, index) => (
            <section key={`${product.name}-${index}`} className="border-b border-[#d9dee8] py-6 last:border-b-0">
              <div className="flex items-center gap-4">
                {result.photos[index] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local data URL
                  <img src={result.photos[index] ?? ""} alt="" className="h-24 w-24 rounded-xl border border-[#d9dee8] object-cover" />
                ) : null}
                <div>
                  <h3 className="text-lg font-semibold">{product.name}</h3>
                  <p className="text-sm text-[#5b6577]">
                    {product.weightG} g · {t(`channels.${product.channel}`)}
                  </p>
                </div>
              </div>
              <table className="mt-4 w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-[#5b6577]">
                    <th className="py-2 pr-3 font-medium">{t("doc.country")}</th>
                    <th className="py-2 pr-3 font-medium">{t("doc.delivery")}</th>
                    {PROPOSAL_QUANTITIES.map((quantity) => (
                      <th key={quantity} className="py-2 pl-3 text-right font-medium">
                        {t("doc.units", { count: quantity })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {product.markets.map((market) => (
                    <tr key={market.destination} className="border-t border-[#e6e9f0] align-top">
                      <td className="py-2.5 pr-3">
                        <span className="font-semibold">{countryName(market.destination)}</span>
                        {detail && market.unit ? (
                          <span className="mt-0.5 block text-xs text-[#5b6577]">
                            {t("doc.split", {
                              product: money(market.unit.product),
                              shipping: money(market.unit.shipping),
                              handling: money(market.unit.handling),
                            })}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        {market.delivery ? t("doc.days", { range: market.delivery }) : "—"}
                      </td>
                      {market.cells.map((cell, cellIndex) => (
                        <td key={cellIndex} className={`py-2.5 pl-3 text-right whitespace-nowrap tabular-nums ${cellIndex === 0 ? "font-semibold" : ""}`}>
                          {cell ? money(cell.total) : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}

          <footer className="pt-5 text-xs leading-relaxed text-[#5b6577]">
            <p>{t("doc.footer", { date: result.date })}</p>
            {note.trim() ? <p className="mt-2 whitespace-pre-line text-[#14213d]">{note.trim()}</p> : null}
          </footer>
        </article>
      ) : null}
    </div>
  );
}
