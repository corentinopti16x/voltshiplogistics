import { SkuFixView, type SkuFixQuery } from "@/components/sourcer/sku-fix-view";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function AdminSkuFixPage({ searchParams }: { searchParams: Promise<SkuFixQuery> }) {
  return <SkuFixView query={await searchParams} base="/admin/skus" />;
}
