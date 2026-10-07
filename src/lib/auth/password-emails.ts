import "server-only";

import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthPortal } from "@/lib/auth/portals";

/** Public base URL of the app (links inside the e-mails). */
export function appBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.voltshiplogistics.com").replace(/\/$/, "");
}

/**
 * Where the e-mail link lands: /auth/callback (allow-listed in Supabase) which forwards to the
 * "choose a password" page of the right portal and language.
 */
export function passwordRedirectUrl(portal: AuthPortal, locale: string) {
  const prefix = locale === "fr" ? "/fr" : "";
  const page = portal === "staff" ? "/staff/reset-password" : "/reset-password";
  return `${appBaseUrl()}/auth/callback?next=${encodeURIComponent(`${prefix}${page}`)}`;
}

/**
 * Sends the Supabase "reset password" e-mail from the server (admin button). Uses a
 * stateless anon client (implicit flow): no PKCE verifier is needed in the recipient's
 * browser, the link carries the session itself.
 */
export async function sendPasswordResetEmail(email: string, portal: AuthPortal, locale: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  const client = createClient(url, key, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: passwordRedirectUrl(portal, locale),
  });
  if (error) throw new Error(error.message);
}

/** Invitation e-mail: creates the auth user and lets them choose their own password. */
export async function sendInviteEmail(
  email: string,
  locale: string,
  appMetadata: Record<string, unknown>,
) {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: passwordRedirectUrl("client", locale),
  });
  if (error || !data.user) throw new Error(error?.message ?? "Invitation failed.");
  await admin.auth.admin.updateUserById(data.user.id, { app_metadata: appMetadata });
  return data.user;
}
