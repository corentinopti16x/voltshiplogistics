import {
  pushPendingProducts,
  reconcileAirtableProducts,
} from "@/lib/airtable/products";
import { validCronRequest } from "@/lib/integrations/webhook-events";

async function run(request: Request) {
  if (!validCronRequest(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const pending = await pushPendingProducts();
    const reconcile = await reconcileAirtableProducts();
    return Response.json({ ok: true, pending, reconcile });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Airtable reconciliation failed." },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
