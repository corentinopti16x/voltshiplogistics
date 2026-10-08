import { validCronRequest } from "@/lib/integrations/webhook-events";
import { reconcileAllClients } from "@/lib/shopify/sync";

export const maxDuration = 300;

/** Every 10 min: Shopify listings sharing a SKU → one Voltship product; duplicates merged. */
async function run(request: Request) {
  if (!validCronRequest(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    return Response.json({ ok: true, clients: await reconcileAllClients() });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Product reconcile failed." },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
