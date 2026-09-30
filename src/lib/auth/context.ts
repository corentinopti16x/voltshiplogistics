import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import {
  IMPERSONATE_COOKIE,
  type AuthContext,
  type Client,
  type Profile,
} from "@/lib/auth/types";

export async function getAuthContext(): Promise<AuthContext | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (!profile) return null;

  void admin
    .from("profiles")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", user.id);

  let clientId = profile.client_id;
  let impersonating = false;
  let impersonatedUserId: string | null = null;

  if (profile.role === "voltship_admin") {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(IMPERSONATE_COOKIE)?.value;

    if (sessionId) {
      const { data: session } = await admin
        .from("impersonation_sessions")
        .select("id, client_id, target_user_id, expires_at, actor_user_id")
        .eq("id", sessionId)
        .maybeSingle();

      const valid =
        session &&
        session.actor_user_id === user.id &&
        new Date(session.expires_at) > new Date();

      if (valid) {
        clientId = session.client_id;
        impersonating = true;
        impersonatedUserId = session.target_user_id;
      }
    }
  }

  let client: Client | null = null;
  if (clientId) {
    const { data } = await admin
      .from("clients")
      .select("id, name, code, language, plan_tier, timezone, created_at")
      .eq("id", clientId)
      .maybeSingle<Client>();
    client = data;
  }

  return {
    userId: user.id,
    email: profile.email || user.email || "",
    role: profile.role,
    actor: profile,
    clientId,
    client,
    impersonating,
    impersonatedUserId,
  };
}

export function isVoltshipAdmin(ctx: AuthContext) {
  return ctx.role === "voltship_admin";
}

export function isTenantUser(ctx: AuthContext) {
  return ctx.role === "owner" || ctx.role === "staff" || ctx.impersonating;
}
