import { validCronRequest } from "@/lib/integrations/webhook-events";
import { isGmailConfigured } from "@/lib/support/gmail";
import { syncAllMailboxes } from "@/lib/support/sync";

/** Every 10 min: pull new Gmail messages for every enabled SAV mailbox, match orders, draft replies. */
async function run(request: Request) {
  if (!validCronRequest(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isGmailConfigured()) {
    return Response.json({ ok: true, skipped: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set" });
  }
  try {
    const result = await syncAllMailboxes();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Support sync failed." },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
