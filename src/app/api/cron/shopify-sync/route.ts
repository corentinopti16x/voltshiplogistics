import { validCronRequest } from "@/lib/integrations/webhook-events";
import {
  classifyAllProducts,
  syncConnectedShopifyShops,
} from "@/lib/shopify/sync";

async function run(request: Request) {
  if (!validCronRequest(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    // ?days=3 → light refresh every 10 minutes (recent orders, shipping status, prices,
    // products, lifecycle); without it → nightly full 90-day resync.
    const daysParam = Number(new URL(request.url).searchParams.get("days"));
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(90, daysParam) : undefined;
    const shops = await syncConnectedShopifyShops({ days });
    const lifecycle = await classifyAllProducts();
    return Response.json({ ok: true, shops, lifecycle });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Shopify sync failed." },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
