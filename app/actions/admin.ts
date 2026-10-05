"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/auth/audit";
import { getAuthContext } from "@/lib/auth/context";
import { generateInvitePassword, slugifyCode } from "@/lib/auth/passwords";
import { parseLineKey, type CarrierRules } from "@/lib/domain/carrier-rules";
import { normalizeDestination } from "@/lib/domain/pricing";
import {
  CLIENT_ROLES,
  IMPERSONATE_COOKIE,
  IMPERSONATE_HOURS,
  LOCALES,
  PLAN_TIERS,
  type ClientRole,
  type PlanTier,
} from "@/lib/auth/types";

export type ActionResult = {
  ok: boolean;
  error?: string;
  clientId?: string;
  password?: string;
};

async function requireAdmin() {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "voltship_admin") {
    return { ctx: null, error: "Admin access required." as const };
  }
  return { ctx, error: null };
}

export async function createClientAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error };

  const name = String(formData.get("name") ?? "").trim();
  const language = String(formData.get("language") ?? "en");
  const planTier = String(formData.get("plan_tier") ?? "bronze");
  const timezone = String(formData.get("timezone") ?? "Europe/Paris").trim();
  let code = String(formData.get("code") ?? "")
    .trim()
    .toLowerCase();

  if (name.length < 2) return { ok: false, error: "Client name is required." };
  if (!LOCALES.includes(language as (typeof LOCALES)[number])) {
    return { ok: false, error: "Language must be EN or FR." };
  }
  if (!PLAN_TIERS.includes(planTier as PlanTier)) {
    return { ok: false, error: "Invalid plan tier." };
  }

  const admin = createAdminClient();
  if (!code) code = slugifyCode(name);

  const { data: taken } = await admin
    .from("clients")
    .select("id")
    .eq("code", code)
    .maybeSingle();

  if (taken) {
    code = `${code}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const { data, error: insertError } = await admin
    .from("clients")
    .insert({
      name,
      code,
      language,
      plan_tier: planTier,
      timezone: timezone || "Europe/Paris",
    })
    .select("id")
    .single();

  if (insertError || !data) {
    return { ok: false, error: insertError?.message ?? "Could not create client." };
  }

  await writeAudit({
    actorUserId: ctx.userId,
    clientId: data.id,
    action: "client.create",
    entity: "clients",
    diff: { name, code, language, plan_tier: planTier },
  });

  revalidatePath("/admin");
  revalidatePath("/[locale]/admin", "page");
  revalidatePath("/admin/clients");
  revalidatePath("/[locale]/admin/clients", "page");
  return { ok: true, clientId: data.id };
}

export async function updatePlanTierAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error };

  const clientId = String(formData.get("client_id") ?? "");
  const planTier = String(formData.get("plan_tier") ?? "");

  if (!clientId) return { ok: false, error: "Missing client." };
  if (!PLAN_TIERS.includes(planTier as PlanTier)) {
    return { ok: false, error: "Invalid plan tier." };
  }

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("clients")
    .select("plan_tier")
    .eq("id", clientId)
    .maybeSingle();

  const { error: updateError } = await admin
    .from("clients")
    .update({ plan_tier: planTier })
    .eq("id", clientId);

  if (updateError) return { ok: false, error: updateError.message };

  await writeAudit({
    actorUserId: ctx.userId,
    clientId,
    action: "client.plan_tier",
    entity: "clients",
    diff: { from: before?.plan_tier, to: planTier },
  });

  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/admin");
  return { ok: true, clientId };
}

export async function updateLifecycleThresholdsAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error };

  const clientId = String(formData.get("client_id") ?? "");
  if (!clientId) return { ok: false, error: "Missing client." };

  const whole = (key: string, min: number, max: number) => {
    const parsed = Number(String(formData.get(key) ?? "").trim());
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
    return parsed;
  };
  const testingMaxAgeDays = whole("testing_max_age_days", 1, 365);
  const winningMinOrdersPerDay14d = whole("winning_min_orders_per_day_14d", 0, 1000);
  const decliningSalesDropPct = whole("declining_sales_drop_pct", 1, 100);
  const deadNoSalesDays = whole("dead_no_sales_days", 1, 365);
  if (
    testingMaxAgeDays == null ||
    winningMinOrdersPerDay14d == null ||
    decliningSalesDropPct == null ||
    deadNoSalesDays == null
  ) {
    return { ok: false, error: "Enter lifecycle thresholds inside the allowed ranges." };
  }

  const thresholds = {
    testing_max_age_days: testingMaxAgeDays,
    winning_min_orders_per_day_14d: winningMinOrdersPerDay14d,
    declining_sales_drop_pct: decliningSalesDropPct,
    dead_no_sales_days: deadNoSalesDays,
  };
  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("clients")
    .update({ lifecycle_thresholds_json: thresholds })
    .eq("id", clientId);
  if (updateError) return { ok: false, error: updateError.message };

  await writeAudit({
    actorUserId: ctx.userId,
    clientId,
    action: "client.lifecycle_thresholds",
    entity: "clients",
    diff: thresholds,
  });
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/admin");
  return { ok: true, clientId };
}

/**
 * Admin carrier rules of a client (clients.carrier_rules_json). Form: one `allowed:<Carrier|Line>`
 * checkbox per line of the active grid (unchecked = blocked) plus an optional
 * `forced:<ISO2>` select per market ("" = client choice). `lines` lists every line key shown,
 * so a line absent from the form (new grid) is never blocked by accident.
 */
export async function updateCarrierRulesAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error };

  const clientId = String(formData.get("client_id") ?? "");
  if (!clientId) return { ok: false, error: "Missing client." };

  const lines = formData
    .getAll("lines")
    .map((value) => String(value))
    .filter((key) => key.includes("|"));
  const allowed = new Set(formData.getAll("allowed").map((value) => String(value)));
  const blocked = lines.filter((key) => !allowed.has(key));
  const forced: CarrierRules["forced"] = {};
  for (const [field, value] of formData.entries()) {
    if (!field.startsWith("forced:")) continue;
    const market = normalizeDestination(field.slice("forced:".length), "");
    const ref = parseLineKey(String(value));
    if (!market || !ref) continue;
    if (blocked.includes(String(value))) {
      return { ok: false, error: `The forced line for ${market} must be allowed.` };
    }
    forced[market] = ref;
  }
  const rules: CarrierRules = { blocked, forced };

  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("clients")
    .update({ carrier_rules_json: rules })
    .eq("id", clientId);
  if (updateError) return { ok: false, error: updateError.message };

  await writeAudit({
    actorUserId: ctx.userId,
    clientId,
    action: "client.carrier_rules",
    entity: "clients",
    diff: rules,
  });
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/[locale]/products", "page");
  revalidatePath("/[locale]/products/[id]", "page");
  revalidatePath("/[locale]/dashboard", "page");
  return { ok: true, clientId };
}

export async function inviteUserAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error };

  const clientId = String(formData.get("client_id") ?? "");
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = String(formData.get("role") ?? "owner") as ClientRole;
  const suppliedPassword = String(formData.get("password") ?? "").trim();

  if (!clientId) return { ok: false, error: "Missing client." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Valid email is required." };
  }
  if (!CLIENT_ROLES.includes(role)) {
    return { ok: false, error: "Role must be owner or staff." };
  }

  const admin = createAdminClient();
  const { data: client } = await admin
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "Client not found." };

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id, client_id, role")
    .eq("email", email)
    .maybeSingle();

  if (existingProfile) {
    return {
      ok: false,
      error: "That email already has an account. Use a different address.",
    };
  }

  const password = suppliedPassword || generateInvitePassword();
  const generated = !suppliedPassword;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, client_id: clientId },
  });

  if (createError || !created.user) {
    return { ok: false, error: createError?.message ?? "Could not invite user." };
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: created.user.id,
    email,
    role,
    client_id: clientId,
  });

  if (profileError) {
    return { ok: false, error: profileError.message };
  }

  await writeAudit({
    actorUserId: ctx.userId,
    clientId,
    action: "user.invite",
    entity: "profiles",
    diff: { email, role },
  });

  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/admin");
  return {
    ok: true,
    clientId,
    password: generated ? password : undefined,
  };
}

export async function startImpersonationAction(clientId: string): Promise<ActionResult> {
  const { ctx, error } = await requireAdmin();
  if (!ctx) return { ok: false, error };
  if (!clientId) return { ok: false, error: "Missing client." };

  const admin = createAdminClient();
  const { data: client } = await admin
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "Client not found." };

  const { data: owner } = await admin
    .from("profiles")
    .select("id")
    .eq("client_id", clientId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: anyUser } = owner
    ? { data: owner }
    : await admin
        .from("profiles")
        .select("id")
        .eq("client_id", clientId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

  const expires = new Date(Date.now() + IMPERSONATE_HOURS * 60 * 60 * 1000);

  const { data: session, error: sessionError } = await admin
    .from("impersonation_sessions")
    .insert({
      actor_user_id: ctx.userId,
      target_user_id: anyUser?.id ?? null,
      client_id: clientId,
      expires_at: expires.toISOString(),
    })
    .select("id")
    .single();

  if (sessionError || !session) {
    return {
      ok: false,
      error: sessionError?.message ?? "Could not start impersonation.",
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATE_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: IMPERSONATE_HOURS * 60 * 60,
  });

  await writeAudit({
    actorUserId: ctx.userId,
    impersonatedUserId: anyUser?.id ?? null,
    clientId,
    action: "impersonate.start",
    entity: "impersonation_sessions",
    diff: { client: client.name },
  });

  revalidatePath("/dashboard");
  revalidatePath("/admin");
  return { ok: true, clientId };
}

export async function stopImpersonationAction(): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(IMPERSONATE_COOKIE)?.value;

  cookieStore.set(IMPERSONATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  if (ctx && sessionId) {
    await writeAudit({
      actorUserId: ctx.userId,
      impersonatedUserId: ctx.impersonatedUserId,
      clientId: ctx.clientId,
      action: "impersonate.stop",
      entity: "impersonation_sessions",
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/admin");
  return { ok: true };
}
