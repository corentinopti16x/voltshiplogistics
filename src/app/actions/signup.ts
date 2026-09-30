"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { slugifyCode } from "@/lib/auth/passwords";
import { LOCALES } from "@/lib/auth/types";
import type { ActionResult } from "@/app/actions/admin";

export type { ActionResult };

export async function hasVoltshipAdmin() {
  const admin = createAdminClient();
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "voltship_admin");

  return (count ?? 0) > 0;
}

export async function signUpAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const companyName = String(formData.get("company") ?? "").trim();
  const language = String(formData.get("language") ?? "en");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { ok: false, error: "Passwords do not match." };
  }
  if (!LOCALES.includes(language as (typeof LOCALES)[number])) {
    return { ok: false, error: "Language must be EN or FR." };
  }

  const admin = createAdminClient();
  const firstAdmin = !(await hasVoltshipAdmin());

  if (!firstAdmin && companyName.length < 2) {
    return { ok: false, error: "Company name is required." };
  }

  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return { ok: false, error: "An account with this email already exists. Sign in instead." };
  }

  const role = firstAdmin ? "voltship_admin" : "owner";
  let clientId: string | null = null;

  if (!firstAdmin) {
    let code = slugifyCode(companyName);
    const { data: taken } = await admin
      .from("clients")
      .select("id")
      .eq("code", code)
      .maybeSingle();
    if (taken) {
      code = `${code}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const { data: client, error: clientError } = await admin
      .from("clients")
      .insert({
        name: companyName,
        code,
        language,
        plan_tier: "bronze",
        timezone: "Europe/Paris",
      })
      .select("id")
      .single();

    if (clientError || !client) {
      return { ok: false, error: clientError?.message ?? "Could not create workspace." };
    }
    clientId = client.id;
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, client_id: clientId },
  });

  if (createError || !created.user) {
    return { ok: false, error: createError?.message ?? "Could not create account." };
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

  return { ok: true, clientId: clientId ?? undefined };
}

export async function signUpAdminAction(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { ok: false, error: "Passwords do not match." };
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return { ok: false, error: "An account with this email already exists. Sign in instead." };
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: "voltship_admin", client_id: null },
  });

  if (createError || !created.user) {
    return { ok: false, error: createError?.message ?? "Could not create account." };
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: created.user.id,
    email,
    role: "voltship_admin",
    client_id: null,
  });

  if (profileError) {
    return { ok: false, error: profileError.message };
  }

  return { ok: true };
}
