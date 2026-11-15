import { revalidatePath } from "next/cache";
import { validCronRequest } from "@/lib/integrations/webhook-events";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Every night: the demo account « Petit Nuage » is rebuilt with dates ending today
 * (function `demo_reset`, migration 00027). No other client is touched.
 */
async function run(request: Request) {
  if (!validCronRequest(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { data, error } = await createAdminClient().rpc("demo_reset");
  if (error) {
    // Migration 00027 not run yet: nothing to refresh, not a failure of the cron.
    return Response.json({ ok: false, error: error.message });
  }
  revalidatePath("/[locale]", "layout");
  return Response.json({ ok: true, result: data });
}

export const GET = run;
export const POST = run;
