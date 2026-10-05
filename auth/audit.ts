import { createAdminClient } from "@/lib/supabase/admin";

export async function writeAudit(entry: {
  actorUserId: string;
  impersonatedUserId?: string | null;
  clientId?: string | null;
  action: string;
  entity?: string;
  diff?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  await admin.from("audit_log").insert({
    actor_user_id: entry.actorUserId,
    impersonated_user_id: entry.impersonatedUserId ?? null,
    client_id: entry.clientId ?? null,
    action: entry.action,
    entity: entry.entity ?? null,
    diff_json: entry.diff ?? null,
  });
}
