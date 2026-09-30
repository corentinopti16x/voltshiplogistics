import { Link } from "@/i18n/routing";
import { LifecycleBadge, SourcingLabel } from "@/components/client/lifecycle-badge";
import { ProductPhoto } from "@/components/client/product-photo";
import type { ProductRow } from "@/lib/products/types";

export function ProductCard({
  product,
  salesDay,
  daysLeft,
  roasBe,
}: {
  product: ProductRow;
  salesDay: string;
  daysLeft: string;
  roasBe: string | null;
}) {
  return (
    <Link
      href={`/products/${product.id}`}
      className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <ProductPhoto src={product.photo_url} alt={product.title} className="h-44 w-full" />
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <LifecycleBadge status={product.lifecycle_status} />
          <SourcingLabel status={product.sourcing_status} />
        </div>
        <h2 className="mt-2 text-sm font-semibold leading-snug">{product.title}</h2>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {salesDay} · {product.stock_manual ?? 0} · {daysLeft}
        </p>
        {roasBe ? (
          <p className="mt-2 text-xs font-medium">ROAS BE {roasBe}</p>
        ) : null}
      </div>
    </Link>
  );
}
