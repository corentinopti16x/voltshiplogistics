import { validCronRequest } from "@/lib/integrations/webhook-events";
import { syncConnectedShopifyShops } from "@/lib/shopify/sync";

export const maxDuration = 300;

/**
 * Shopify orders and products of every connected shop: ?days=3 → light refresh every
 * 10 minutes; without it → nightly full 90-day resync. Lifecycle (cron/lifecycle) and
 * upsells (cron/upsells) run in their own crons so a long sync can never cut them off.
 */
async function run(request: Request) {
  if (!validCronRequest(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const daysParam = Number(new URL(request.url).searchParams.get("days"));
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(90, daysParam) : undefined;
    const shops = await syncConnectedShopifyShops({ days });
    return Response.json({ ok: true, shops });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Shopify sync failed." },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
