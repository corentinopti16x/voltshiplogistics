import { CLIENT_ROLES, type UserRole } from "./types";

export const INTERNAL_ROLES = ["sourcer", "voltship_admin"] as const;
export type AuthPortal = "client" | "staff";

export function isClientRole(role: UserRole) {
  return (CLIENT_ROLES as readonly string[]).includes(role);
}

export function isInternalRole(role: UserRole) {
  return role === "sourcer" || role === "voltship_admin";
}

export function destinationForRole(role: UserRole) {
  if (role === "sourcer") return "/sourcer";
  if (role === "voltship_admin") return "/admin";
  return "/dashboard";
}

export function roleBelongsToPortal(role: UserRole, portal: AuthPortal) {
  return portal === "staff" ? isInternalRole(role) : isClientRole(role);
}
