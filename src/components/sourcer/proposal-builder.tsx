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

  // Only the proposal goes to the printer: a copy is placed directly under <body>, the rest of
  // the page is hidden (no blank page, no app header), and the copy is removed afterwards.
  function printProposal() {
    const source = document.getElementById("proposal-doc");
    if (!source) return;
    document.getElementById("proposal-print")?.remove();
    const holder = document.createElement("div");
    holder.id = "proposal-print";
    holder.appendChild(source.cloneNode(true));
    document.body.appendChild(holder);
    const previousTitle = document.title;
    document.title = `${t("doc.title")}${prospect.trim() ? ` - ${prospect.trim()}` : ""} - Voltship`;
    const cleanup = () => {
      holder.remove();
      document.title = previousTitle;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  const deliveryText = (raw: string) =>
    /^[\d\s–-]+$/.test(raw) ? t("doc.days", { range: raw.trim() }) : raw;

  return (
    <div className="space-y-8">
      <style>{`
        #proposal-print { display: none; }
        @media print {
          html, body { background: #fff !important; height: auto !important; min-height: 0 !important; }
          body > *:not(#proposal-print) { display: none !important; }
          #proposal-print { display: block !important; }
          #proposal-print article { border: 0 !important; border-radius: 0 !important; }
          #proposal-print section { break-inside: avoid; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @page { size: A4; margin: 0; }
        }
      `}</style>

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
            <button type="button" onClick={printProposal} className="rounded-full px-5 py-2 text-sm font-semibold ring-1 ring-[var(--line)]">
              {t("pdf")}
            </button>
          ) : null}
          {error ? <p className="text-sm text-[var(--rust-ink)]">{error}</p> : null}
        </div>
        {result ? <p className="mt-3 text-xs text-[var(--muted)]">{t("pdfHint")}</p> : null}
      </div>

      {result ? (
        <article id="proposal-doc" className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white text-[#14213d]">
          <header className="flex items-end justify-between gap-6 bg-[#14213d] px-10 py-8 text-white">
            <div>
              <p className="flex items-center gap-2 text-sm font-extrabold tracking-[0.18em]">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-white/10">
                  <svg width="14" height="16" viewBox="0 0 20 22" aria-hidden>
                    <path d="M0 1h4.6l5.1 12.2L14.8 1H19.4L11.6 21H7.8z" fill="#FFFFFF" />
                    <path d="M15.4 0 9.6 8.2h3L11.2 14.5l5.8-8.3h-3z" fill="#E8B04F" />
                  </svg>
                </span>
                VOLTSHIP LOGISTICS
              </p>
              <h2 className="mt-5 text-3xl font-semibold">{t("doc.title")}</h2>
              {prospect.trim() ? <p className="mt-1 text-base text-white/80">{t("doc.for", { name: prospect.trim() })}</p> : null}
            </div>
            <p className="text-right text-sm text-white/70">{result.date}</p>
          </header>

          <div className="px-10 pb-8">
            {result.products.map((product, index) => (
              <section key={`${product.name}-${index}`} className="border-b border-[#e3e7ef] py-7 last:border-b-0">
                <div className="flex items-center gap-5">
                  {result.photos[index] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local data URL
                    <img src={result.photos[index] ?? ""} alt="" className="h-32 w-32 rounded-2xl border border-[#e3e7ef] object-cover" />
                  ) : null}
                  <div>
                    <h3 className="text-2xl font-semibold">{product.name}</h3>
                    <p className="mt-1 text-sm text-[#5b6577]">
                      {t("doc.specs", { weight: product.weightG, type: t(`channels.${product.channel}`) })}
                    </p>
                  </div>
                </div>

                {product.markets.map((market) => (
                  <div key={market.destination} className="mt-5 rounded-2xl border border-[#e3e7ef] p-5" style={{ breakInside: "avoid" }}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                      <p className="text-lg font-semibold">{countryName(market.destination)}</p>
                      <p className="text-sm text-[#5b6577]">
                        {market.line ? t("doc.line", { line: market.line }) : null}
                        {market.line && market.delivery ? " · " : null}
                        {market.delivery ? (
                          <span className="font-semibold text-[#14213d]">{t("doc.delivery", { delay: deliveryText(market.delivery) })}</span>
                        ) : null}
                      </p>
                    </div>
                    <div className="mt-4 grid grid-cols-5 gap-2">
                      {market.cells.map((cell, cellIndex) => (
                        <div
                          key={cellIndex}
                          className={`rounded-xl px-3 py-3 text-center ${cellIndex === 0 ? "bg-[#14213d] text-white" : "bg-[#f3f5f9]"}`}
                        >
                          <p className={`text-xs ${cellIndex === 0 ? "text-white/70" : "text-[#5b6577]"}`}>
                            {t("doc.units", { count: PROPOSAL_QUANTITIES[cellIndex] })}
                          </p>
                          <p className="mt-1 text-lg font-semibold tabular-nums">{cell ? money(cell.total) : "—"}</p>
                          {cell && cell.quantity > 1 ? (
                            <p className="text-[11px] text-[#5b6577]">{t("doc.perUnit", { price: money(cell.perUnit) })}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    {detail && market.unit ? (
                      <p className="mt-3 text-xs text-[#5b6577]">
                        {t("doc.split", {
                          product: money(market.unit.product),
                          shipping: money(market.unit.shipping),
                        })}
                      </p>
                    ) : null}
                  </div>
                ))}
              </section>
            ))}

            <footer className="pt-5 text-xs leading-relaxed text-[#5b6577]">
              <p>{t("doc.footer", { date: result.date })}</p>
              {note.trim() ? <p className="mt-2 whitespace-pre-line text-sm text-[#14213d]">{note.trim()}</p> : null}
            </footer>
          </div>
        </article>
      ) : null}
    </div>
  );
}
