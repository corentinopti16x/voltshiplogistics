import { localePathPrefix } from "@/lib/shopify/auth";
import { encryptSupportToken } from "@/lib/support/crypto";
import { exchangeGmailCode, getGmailProfile, parseGmailState } from "@/lib/support/gmail";
import { createAdminClient } from "@/lib/supabase/admin";

/** Google OAuth redirect URI: exchanges the code, stores the encrypted refresh token + address. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || url.origin).replace(/\/$/, "");
  let state: ReturnType<typeof parseGmailState> = null;
  try {
    state = parseGmailState(url.searchParams.get("state"));
  } catch {
    state = null;
  }
  const base = `${appUrl}${localePathPrefix(state?.locale)}/settings`;
  const fail = (message: string) => Response.redirect(`${base}?gmail_error=${encodeURIComponent(message)}`);

  if (url.searchParams.get("error")) return fail(`Google: ${url.searchParams.get("error")}`);
  const code = url.searchParams.get("code");
  if (!code || !state) return fail("Invalid or expired Google callback. Please start the connection again.");

  try {
    const tokens = await exchangeGmailCode(code, appUrl);
    const profile = await getGmailProfile(tokens.accessToken);
    const admin = createAdminClient();
    // One active mailbox per client: previous ones are disabled (history kept).
    await admin.from("support_mailboxes").update({ enabled: false }).eq("client_id", state.clientId);
    const { error } = await admin.from("support_mailboxes").upsert(
      {
        client_id: state.clientId,
        provider: "gmail",
        email_address: profile.emailAddress.toLowerCase(),
        refresh_token_encrypted: encryptSupportToken(tokens.refreshToken),
        history_id: null,
        sync_error: null,
        enabled: true,
      },
      { onConflict: "client_id,provider,email_address" },
    );
    if (error) throw error;
    return Response.redirect(`${base}?gmail_connected=1`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Gmail connection failed.");
  }
}
