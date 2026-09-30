import Image from "next/image";

type Status = "winning" | "testing" | "declining" | "dead";

const badgeClass: Record<Status, string> = {
  winning: "bg-[#ead9a3] text-[#5a4a18]",
  testing: "bg-[#d5e4f4] text-[#1d3b5c]",
  declining: "bg-[#f0d3b8] text-[#6a3b14]",
  dead: "bg-[#e4e2dc] text-[#555248]",
};

export type PreviewProduct = {
  name: string;
  image: string;
  status: Status;
  statusLabel: string;
  sales: string;
  days: string;
  roas?: string;
};

export function AppPreview({
  title,
  filterAll,
  salesDay,
  daysLeft,
  products,
}: {
  title: string;
  filterAll: string;
  salesDay: string;
  daysLeft: string;
  products: PreviewProduct[];
}) {
  return (
    <div className="landing-tilt relative">
      <div
        aria-hidden
        className="absolute -inset-8 rounded-[2rem] bg-[radial-gradient(circle_at_50%_40%,rgba(196,163,90,0.22),transparent_62%)]"
      />
      <div className="relative overflow-hidden rounded-[22px] border border-white/15 bg-[#f7f3ea] shadow-[0_40px_80px_rgba(0,0,0,0.38)]">
        <div className="flex items-center gap-2 border-b border-[#e6dfd2] bg-[#efe8da] px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#e2b6b0]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ead9a3]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#b9cbb8]" />
          <p className="ml-3 text-[11px] font-medium tracking-wide text-[#6a6558]">
            {title}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 px-4 pt-4">
          {["Winning", "Testing", "Declining"].map((label, index) => (
            <span
              key={label}
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide ${
                index === 0
                  ? "bg-[#24382c] text-[#f3eee4]"
                  : "bg-white text-[#6a6558] ring-1 ring-[#d9d1c2]"
              }`}
            >
              {index === 0 ? filterAll : label}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 p-4">
          {products.map((product) => (
            <article
              key={product.name}
              className="overflow-hidden rounded-2xl bg-white shadow-[0_8px_24px_rgba(28,26,20,0.06)] ring-1 ring-[#e8e1d4]"
            >
              <div className="relative h-28">
                <Image
                  src={product.image}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="220px"
                />
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[9px] font-semibold tracking-wide uppercase ${badgeClass[product.status]}`}
                  >
                    {product.statusLabel}
                  </span>
                  {product.roas ? (
                    <span className="text-[10px] text-[#6a6558]">ROAS {product.roas}</span>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[13px] font-medium leading-snug text-[#1c1a14]">
                  {product.name}
                </p>
                <p className="mt-1 text-[11px] text-[#6a6558]">
                  {product.sales} {salesDay} · {product.days} {daysLeft}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
