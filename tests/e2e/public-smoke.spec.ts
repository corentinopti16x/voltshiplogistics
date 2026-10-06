import { expect, test } from "@playwright/test";

test("landing and authentication pages render", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Voltship/i);
  await expect(page.getByRole("link", { name: /sign in/i }).first()).toBeVisible();

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
});

test("French login route renders", async ({ page }) => {
  await page.goto("/fr/login");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("staff login is a separate portal", async ({ page }) => {
  await page.goto("/staff/login");
  await expect(page.getByRole("heading", { name: /staff sign in/i })).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /forgot password/i })).toBeVisible();
});

test("admin signup is disabled (invite-only) and password reset is reachable", async ({ page }) => {
  // There is no signup page: anonymous visitors are sent to the staff login instead.
  await page.goto("/staff/signup");
  await expect(page).not.toHaveURL(/signup/);
  await expect(page).toHaveURL(/staff\/login/);

  await page.goto("/staff/forgot-password");
  await expect(page.getByRole("heading", { name: /reset admin password/i })).toBeVisible();
  await expect(page.getByLabel(/^email$/i)).toBeVisible();
});
