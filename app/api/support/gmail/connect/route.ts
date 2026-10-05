import { getAuthContext } from "@/lib/auth/context";
import { localePathPrefix, type OAuthLocale } from "@/lib/shopify/auth";
import { buildGmailAuthorizeUrl, isGmailConfigured } from "@/lib/support/gmail";

/**
 * GET /api/support/gmail/connect?locale=fr|en — owner only. Redirects to Google's consent
 * screen (scope gmail.modify, offline access). Nothing is written before the signed callback.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || url.origin).replace(/\/$/, "");
  const locale: OAuthLocale = url.searchParams.get("locale") === "fr" ? "fr" : "en";
  const back = `${appUrl}${localePathPrefix(locale)}/settings`;
  const fail = (message: string) => Response.redirect(`${back}?gmail_error=${encodeURIComponent(message)}`);

  const ctx = await getAuthContext();
  if (!ctx) return Response.redirect(`${appUrl}${localePathPrefix(locale)}/login`);
  if (ctx.role === "staff") return fail("Only the company owner can connect the mailbox.");
  if (!ctx.clientId) return fail("Not signed in to a workspace.");
  if (!isGmailConfigured()) return fail("Gmail is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");

  try {
    return Response.redirect(buildGmailAuthorizeUrl({ appUrl, state: { clientId: ctx.clientId, locale } }), 302);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Gmail is not configured.");
  }
}
