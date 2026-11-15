import { revalidatePath } from "next/cache";
import { validCronRequest } from "@/lib/integrations/webhook-events";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Every night: the demo account « Petit Nuage » gets its dates moved so that its last order
 * is today (function `demo_roll_dates`, migration 00027). No other client is touched.
 */
async function run(request: Request) {
  if (!validCronRequest(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { data, error } = await createAdminClient().rpc("demo_roll_dates");
  if (error) {
    // Migration 00027 not run yet: nothing to refresh, not a failure of the cron.
    return Response.json({ ok: false, error: error.message });
  }
  const days = Number(data) || 0;
  if (days > 0) revalidatePath("/[locale]", "layout");
  return Response.json({ ok: true, days });
}

export const GET = run;
export const POST = run;
