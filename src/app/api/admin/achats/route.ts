import { getAuthContext } from "@/lib/auth/context";
import { loadAchats } from "@/lib/orders/to-ship-server";
import { buyListCsv, pendingOrdersCsv } from "@/lib/orders/to-ship";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** CSV exports of the « Achats » page: ?type=buy (what to buy) or ?type=orders (orders to send). */
export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "voltship_admin" || ctx.impersonating) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const url = new URL(request.url);
  const type = url.searchParams.get("type") === "orders" ? "orders" : "buy";
  const sinceParam = url.searchParams.get("since") ?? "";
  const since = /^\d{4}-\d{2}-\d{2}$/.test(sinceParam)
    ? sinceParam
    : new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const cover = Number(url.searchParams.get("cover"));
  const data = await loadAchats({
    since,
    clientId: url.searchParams.get("client") || null,
    coverDays: Number.isFinite(cover) && cover > 0 && cover <= 120 ? cover : undefined,
  });
  const body = type === "orders" ? pendingOrdersCsv(data.pending) : buyListCsv(data.buy);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = type === "orders" ? `commandes-a-expedier-${stamp}.csv` : `achats-${stamp}.csv`;
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
