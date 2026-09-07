import { expect, test } from "@playwright/test";

/**
 * Guard #1 smoke coverage (FRONTEND_SPEC.md §0.1, middleware.ts) — an
 * unauthenticated visitor to any role-gated route group is redirected to
 * `/login` with `next` preserved, before any protected content renders.
 * Deliberately does not touch Supabase — these are pure "no session cookie"
 * paths, so no backend needs to be reachable for this spec to be meaningful.
 */
test.describe("role-guard redirects", () => {
  test("redirects an unauthenticated visitor from /dashboard to /login", async ({ page }) => {
    const response = await page.goto("/dashboard");
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  });

  test("redirects an unauthenticated visitor from /cockpit to /login", async ({ page }) => {
    await page.goto("/cockpit");
    await expect(page).toHaveURL(/\/login\?next=%2Fcockpit/);
  });

  test("redirects an unauthenticated visitor from /portal to /login", async ({ page }) => {
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/login\?next=%2Fportal/);
  });

  test("does not redirect the public /login page itself", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  });
});
