import { randomBytes } from "crypto";

export function generateInvitePassword() {
  return randomBytes(12).toString("base64url").slice(0, 16);
}

export function slugifyCode(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  return base || "client";
}
