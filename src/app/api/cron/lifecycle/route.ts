import { validCronRequest } from "@/lib/integrations/webhook-events";
import { classifyAllProducts } from "@/lib/shopify/sync";

export const maxDuration = 300;

/** Every 10 min, after the Shopify sync: Testing / Winning / Declining / Dead from the sales. */
async function run(request: Request) {
  if (!validCronRequest(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    return Response.json({ ok: true, lifecycle: await classifyAllProducts() });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Lifecycle classification failed." },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
