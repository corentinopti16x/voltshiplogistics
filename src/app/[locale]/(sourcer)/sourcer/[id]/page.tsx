import { notFound } from "next/navigation";
import { redirect, Link } from "@/i18n/routing";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductRequest, type ProductRow } from "@/lib/products/types";
import { ProductPhoto } from "@/components/client/product-photo";
import { SourcerShell } from "@/components/sourcer/sourcer-shell";
import { SourcingWorkForm } from "@/components/sourcer/sourcing-work-form";

export default async function SourcerProductPage({
  params,
}: {
  params: Promise<{ locale: "en" | "fr"; id: string }>;
}) {
  const { locale, id } = await params;
  const ctx = await getAuthContext();
  if (!ctx) {
    redirect({ href: "/staff/login", locale });
    return null;
  }
  if (ctx.role !== "sourcer" && ctx.role !== "voltship_admin") {
    redirect({ href: "/home", locale });
    return null;
  }

  const admin = createAdminClient();
  const [{ data: productData }, { data: work }] = await Promise.all([
    admin
      .from("products_cache")
      .select("*, clients!inner(name, code)")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("sourcing_work")
      .select(
        "factory_purchase_price, supplier_name, supplier_contact, sourcing_location, internal_notes, flagged_reason",
      )
      .eq("product_id", id)
      .maybeSingle(),
  ]);
  if (!productData) notFound();
  const product = productData as ProductRow & {
    clients: { name: string; code: string | null };
  };
  const request = getProductRequest(product);

  return (
    <SourcerShell role={ctx.role}>
      <Link href="/sourcer" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
        ← Sourcing queue
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <ProductPhoto
          src={product.photo_url}
          alt={product.title}
          className="h-40 w-40 rounded-2xl"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-[var(--muted)]">
            {product.clients.name} · {product.sku ?? "No SKU"}
          </p>
          <h1 className="font-display mt-1 text-3xl">{product.title}</h1>
        </div>
        <span className="rounded-full bg-[var(--card)] px-3 py-1 text-xs capitalize ring-1 ring-[var(--line)]">
          {(product.sourcing_status ?? "brief_received").replaceAll("_", " ")}
        </span>
      </div>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold">Client brief</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <Item label="Description" value={request.description} />
          <Item label="Target unit price" value={request.target_unit_price} />
          <Item label="Launch quantity" value={request.expected_launch_qty} />
          <Item label="Destination markets" value={request.destination_markets} />
          <Item label="Notes" value={request.notes} />
          {request.source_url ? (
            <div>
              <dt className="text-xs text-[var(--muted)]">Reference</dt>
              <dd className="mt-1">
                <a
                  href={request.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Open source link
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <div className="mt-6">
        <SourcingWorkForm product={product} work={work} />
      </div>
    </SourcerShell>
  );
}

function Item({ label, value }: { label: string; value: unknown }) {
  if (value == null || value === "") return null;
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1">{String(value)}</dd>
    </div>
  );
}
