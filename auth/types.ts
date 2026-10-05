export const PLAN_TIERS = ["bronze", "silver", "gold", "scale"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const USER_ROLES = [
  "owner",
  "staff",
  "sourcer",
  "voltship_admin",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const CLIENT_ROLES = ["owner", "staff"] as const;
export type ClientRole = (typeof CLIENT_ROLES)[number];

export const LOCALES = ["en", "fr"] as const;
export type AppLocale = (typeof LOCALES)[number];

export type Profile = {
  id: string;
  client_id: string | null;
  email: string;
  role: UserRole;
  last_login_at: string | null;
  created_at: string;
};

export type Client = {
  id: string;
  name: string;
  code: string | null;
  language: AppLocale;
  plan_tier: PlanTier;
  timezone: string;
  created_at: string;
};

export type AuthContext = {
  userId: string;
  email: string;
  role: UserRole;
  actor: Profile;
  /** Tenant scope. Always from session / impersonation — never from request params. */
  clientId: string | null;
  client: Client | null;
  impersonating: boolean;
  impersonatedUserId: string | null;
};

export const IMPERSONATE_COOKIE = "vs_impersonate";
export const IMPERSONATE_HOURS = 8;
