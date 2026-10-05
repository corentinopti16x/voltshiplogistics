import { validCronRequest } from "@/lib/integrations/webhook-events";
import { isEccangConfigured } from "@/lib/eccang/client";
import { syncAllEccangClients } from "@/lib/eccang/sync";

/** Every 15 min: for each eccang_enabled client → inventory + pending orders + ASNs. */
async function run(request: Request) {
  if (!validCronRequest(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isEccangConfigured()) {
    return Response.json({ ok: true, skipped: "ECCANG_API_HOST not set" });
  }
  try {
    const result = await syncAllEccangClients();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "ECCANG sync failed." },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
