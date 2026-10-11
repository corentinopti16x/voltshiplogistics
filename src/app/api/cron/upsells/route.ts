import { validCronRequest } from "@/lib/integrations/webhook-events";
import { refreshAutoUpsellsForShops } from "@/lib/products/upsells-server";

export const maxDuration = 300;

/**
 * Products bought together become upsells of the dearer one: ?days=3 every 10 min adds the
 * new ones; without it, the nightly run recounts the last 90 days.
 */
async function run(request: Request) {
  if (!validCronRequest(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const daysParam = Number(new URL(request.url).searchParams.get("days"));
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(90, daysParam) : 90;
    return Response.json({ ok: true, upsells: await refreshAutoUpsellsForShops({ days }) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Upsell detection failed." },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
