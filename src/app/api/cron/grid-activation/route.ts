import { revalidatePath } from "next/cache";
import { validCronRequest } from "@/lib/integrations/webhook-events";
import { applyScheduledGridActivation } from "@/lib/pricing/server";

/** Every 5 min: a grid scheduled for activation becomes the active grid once its time has come. */
async function run(request: Request) {
  if (!validCronRequest(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const activated = await applyScheduledGridActivation();
    if (activated) {
      revalidatePath("/[locale]/admin/pricing", "page");
      revalidatePath("/[locale]/products/[id]", "page");
      revalidatePath("/[locale]/sourcer/products", "page");
    }
    return Response.json({ ok: true, activated });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Scheduled grid activation failed." },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
