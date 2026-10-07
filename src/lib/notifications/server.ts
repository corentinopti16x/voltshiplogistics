import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { allowedChannels, type ChannelPreference } from "@/lib/notifications/channels";

export async function createNotification(input: {
  clientId: string;
  userId?: string | null;
  type: string;
  payload: Record<string, unknown>;
  channels?: string[];
}) {
  const requested = input.channels ?? ["in_app"];
  const admin = createAdminClient();
  const channels = allowedChannels(requested, await loadChannelPreferences(admin, input));
  if (channels.length === 0) return { id: null };

  const { data, error } = await admin
    .from("notifications")
    .insert({
      client_id: input.clientId,
      user_id: input.userId ?? null,
      type: input.type,
      payload_json: input.payload,
      channels,
    })
    .select("id")
    .single();
  if (error) throw error;

  const webhookUrl = process.env.N8N_NOTIFICATION_WEBHOOK_URL;
  if (webhookUrl && channels.some((channel) => channel === "email" || channel === "whatsapp")) {
    try {
      const contact = await loadClientContact(admin, input.clientId);
      await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.N8N_SHARED_SECRET
            ? { Authorization: `Bearer ${process.env.N8N_SHARED_SECRET}` }
            : {}),
        },
        body: JSON.stringify({
          notification_id: data.id,
          client_id: input.clientId,
          user_id: input.userId ?? null,
          type: input.type,
          channels,
          payload: input.payload,
          client: contact,
        }),
        cache: "no-store",
      });
    } catch {
      // In-app notification is authoritative; channel delivery retries are external.
    }
  }
  return data;
}

/** Name, language and WhatsApp number of the client, sent to n8n with every notification. */
async function loadClientContact(admin: ReturnType<typeof createAdminClient>, clientId: string) {
  const { data, error } = await admin
    .from("clients")
    .select("name, language, whatsapp_number")
    .eq("id", clientId)
    .maybeSingle();
  if (error) {
    // Column not migrated yet (00015): still send name + language.
    const { data: basic } = await admin
      .from("clients")
      .select("name, language")
      .eq("id", clientId)
      .maybeSingle();
    return { name: basic?.name ?? null, locale: basic?.language ?? "fr", whatsapp_to: null };
  }
  return {
    name: data?.name ?? null,
    locale: data?.language ?? "fr",
    whatsapp_to: data?.whatsapp_number ?? null,
  };
}

async function loadChannelPreferences(
  admin: ReturnType<typeof createAdminClient>,
  input: { clientId: string; userId?: string | null; type: string },
): Promise<Array<ChannelPreference | null>> {
  const { data: users } = await admin
    .from("profiles")
    .select("id")
    .eq("client_id", input.clientId)
    .in("role", input.userId ? ["owner", "staff"] : ["owner"]);
  const userIds = input.userId
    ? [input.userId]
    : (users ?? []).map((user) => user.id);
  if (userIds.length === 0) return [];

  const { data: saved } = await admin
    .from("notification_preferences")
    .select("user_id, in_app, email, whatsapp")
    .eq("client_id", input.clientId)
    .eq("event_type", input.type)
    .in("user_id", userIds);
  const byUser = new Map((saved ?? []).map((row) => [row.user_id, row]));
  return userIds.map((userId) => {
    const row = byUser.get(userId);
    return row
      ? { in_app: row.in_app, email: row.email, whatsapp: row.whatsapp }
      : null;
  });
}
