import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, database: "unconfigured" },
      { status: 503 },
    );
  }
  try {
    const admin = createAdminClient();
    const [{ error: dbError }, { data: shops }, { data: deadEvents }] = await Promise.all([
      admin.from("clients").select("id", { head: true, count: "exact" }),
      admin
        .from("shops")
        .select("last_synced_at, sync_error")
        .eq("status", "active")
        .order("last_synced_at", { ascending: true, nullsFirst: true })
        .limit(1),
      admin
        .from("webhook_events")
        .select("id")
        .eq("status", "dead")
        .limit(10),
    ]);
    if (dbError) throw dbError;
    return NextResponse.json({
      ok: true,
      database: "connected",
      oldestShopSync: shops?.[0]?.last_synced_at ?? null,
      shopSyncError: shops?.[0]?.sync_error ?? null,
      deadWebhookEvents: deadEvents?.length ?? 0,
    });
  } catch {
    return NextResponse.json(
      { ok: false, database: "unavailable" },
      { status: 503 },
    );
  }
}
