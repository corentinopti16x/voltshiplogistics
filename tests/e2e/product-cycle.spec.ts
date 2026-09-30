import { expect, test } from "@playwright/test";

const email = process.env.E2E_OWNER_EMAIL;
const password = process.env.E2E_OWNER_PASSWORD;
const productId = process.env.E2E_QUOTED_PRODUCT_ID;

test("owner can review and accept a prepared quote", async ({ page }) => {
  test.skip(!email || !password || !productId, "Requires seeded Phase 1 acceptance data.");
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email!);
  await page.getByLabel(/password/i).fill(password!);
  await page.getByRole("button", { name: /continue/i }).click();
  await page.goto(`/products/${productId}`);
  await expect(page.getByText(/COGS \/ unit/i)).toBeVisible();
  const accept = page.getByRole("button", { name: /accept quote/i });
  if (await accept.isVisible()) await accept.click();
  await expect(page.getByText(/quote accepted/i)).toBeVisible();
});
