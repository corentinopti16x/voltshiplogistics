export function QuotePreview({
  kicker,
  productName,
  productLabel,
  productPrice,
  shippingLabel,
  shippingPrice,
  handlingLabel,
  handlingPrice,
  totalLabel,
  totalPrice,
  badge,
  carrier,
}: {
  kicker: string;
  productName: string;
  productLabel: string;
  productPrice: string;
  shippingLabel: string;
  shippingPrice: string;
  handlingLabel: string;
  handlingPrice: string;
  totalLabel: string;
  totalPrice: string;
  badge: string;
  carrier: string;
}) {
  return (
    <div className="relative rounded-3xl p-[1px] bg-gradient-to-br from-[var(--gold)]/30 via-[var(--line)] to-[var(--gold)]/10">
      <div className="rounded-3xl bg-[var(--card)] p-8 shadow-[0_24px_60px_rgba(28,26,20,0.08)]">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--card)]">
            <svg
              width="16"
              height="16"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <path d="M14 2v6h6" />
              <path d="M16 13H8M16 17H8M10 9H8" />
            </svg>
          </div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--gold)] uppercase">
            {kicker}
          </p>
        </div>

        <h3 className="mt-4 text-xl font-semibold tracking-tight">
          {productName}
        </h3>
        <p className="mt-1 text-sm text-[var(--muted)]">{carrier}</p>

        <dl className="mt-7 space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--muted)]">{productLabel}</dt>
            <dd className="font-medium">{productPrice}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--muted)]">{shippingLabel}</dt>
            <dd className="font-medium">{shippingPrice}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--muted)]">{handlingLabel}</dt>
            <dd className="font-medium">{handlingPrice}</dd>
          </div>
          <div className="flex justify-between border-t border-[var(--line)] pt-3.5 text-base font-semibold">
            <dt>{totalLabel}</dt>
            <dd className="text-[var(--accent)]">{totalPrice}</dd>
          </div>
        </dl>

        <div className="mt-6 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ead9a3]/60 px-3 py-1.5 text-[11px] font-medium text-[#5a4a18]">
            <svg
              width="12"
              height="12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            {badge}
          </span>
        </div>
      </div>
    </div>
  );
}
