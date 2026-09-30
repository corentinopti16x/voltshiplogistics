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
    const shops = await syncConnectedShopifyShops();
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
