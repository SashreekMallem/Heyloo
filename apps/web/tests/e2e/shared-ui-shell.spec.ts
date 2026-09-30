import { expect, test } from "@playwright/test";
import { authStorageState, isLocalSupabaseReachable } from "./support/auth-state.js";
import { provisionTenantOwner } from "./support/provision-test-users.js";

/**
 * Shared app-shell behaviour for a signed-in tenant owner (QA-1): current-page
 * highlighting (F-01), the phone navigation drawer (MAP-01/F-13/MAP-11) and
 * Log out (AUTH-02/MAP-04). Requires the local Supabase stack, like the other
 * authenticated specs (docs/DEPLOY.md), and self-skips without it.
 */
const SKIP = "requires a local `supabase start` instance — see docs/DEPLOY.md";

test.describe("tenant shell on a phone", () => {
  test.use({
    storageState: authStorageState("tenant-owner"),
    viewport: { width: 390, height: 844 },
  });

  test("tapping a drawer link navigates and closes the drawer", async ({ page }) => {
    test.skip(!isLocalSupabaseReachable(), SKIP);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("link", { name: "Billing" }).click();
    await expect(page).toHaveURL(/\/dashboard\/billing/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Escape closes the drawer and focus goes back to the toggle", async ({ page }) => {
    test.skip(!isLocalSupabaseReachable(), SKIP);
    await page.goto("/dashboard");
    const toggle = page.getByRole("button", { name: "Toggle sidebar" });
    await toggle.click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(toggle).toBeFocused();
  });

  test("the More tab opens the drawer instead of going to Support", async ({ page }) => {
    test.skip(!isLocalSupabaseReachable(), SKIP);
    await page.goto("/dashboard");
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "More" })
      .click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("only the current section is marked, not Overview as well", async ({ page }) => {
    test.skip(!isLocalSupabaseReachable(), SKIP);
    await page.goto("/dashboard/calls");
    const tabs = page.getByRole("navigation", { name: "Primary" });
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(tabs.getByRole("link", { name: "Calls" })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("Log out", () => {
  // A fresh, unshared session: signing out revokes that session, and the
  // saved `tenant-owner` storageState is reused by other specs.
  test("the account menu ends the session and lands on /login", async ({ page }) => {
    test.skip(!isLocalSupabaseReachable(), SKIP);
    const owner = await provisionTenantOwner();
    await page.goto("/login");
    await page.getByLabel("Email").fill(owner.email);
    await page.getByLabel("Password").fill(owner.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/dashboard/);

    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByText(owner.email)).toBeVisible();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await page.waitForURL(/\/login/);

    // The session is really gone: the guard bounces /dashboard back to login.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  });
});
