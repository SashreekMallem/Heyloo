import { expect, test } from "@playwright/test";
import { authStorageState, isLocalSupabaseReachable } from "./support/auth-state.js";

/**
 * QA-1 (portal-settings) regression flows, against a real local Supabase
 * with the "setup" project's `tenant-owner` session (see `auth.setup.ts`).
 * Like the other authenticated specs these cannot run in a sandbox without
 * Docker; they self-skip there and run in CI/locally per `docs/DEPLOY.md`.
 * The same behaviours are also covered by component/route unit tests.
 */
test.use({ storageState: authStorageState("tenant-owner") });

const SKIP_REASON = "requires a local `supabase start` instance — see docs/DEPLOY.md";

test("F-1: Setup → Offerings → Add offering opens the dialog instead of crashing", async ({
  page,
}) => {
  test.skip(!isLocalSupabaseReachable(), SKIP_REASON);

  await page.goto("/dashboard/setup/offerings");
  await page
    .getByRole("button", { name: /Add offering/ })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Modifiers")).toBeVisible();
  await expect(page.getByText("Something went wrong loading this.")).toHaveCount(0);

  await dialog.getByPlaceholder(/Oil change/).fill("QA e2e offering");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
});

test("F-2: phone setup shows AT&T's own forwarding codes with a 10-digit number", async ({
  page,
}) => {
  test.skip(!isLocalSupabaseReachable(), SKIP_REASON);

  await page.goto("/dashboard/phone-setup");
  // AT&T is preselected: GSM conditional code, never Verizon's *71/*73 and never "+1".
  await expect(page.getByText(/^\*004\*\d{10}\*11#$/)).toBeVisible();
  await expect(page.getByText("##004#")).toBeVisible();
  await expect(page.getByText(/\+1\d{10}/)).toHaveCount(0);

  await page.getByRole("button", { name: "Verizon" }).click();
  await expect(page.getByText(/^\*71\d{10}$/)).toBeVisible();
  await expect(page.getByText("*73")).toBeVisible();
});

test("F-12/F-11: on a phone the widget preview does not cover the bottom nav and lists use cards", async ({
  page,
}) => {
  test.skip(!isLocalSupabaseReachable(), SKIP_REASON);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/website-widget");
  await expect(page.getByText(/live preview needs a wider screen/)).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.locator("#heyloo-widget-host")).toHaveCount(0);

  await page.goto("/dashboard/agent/services");
  await expect(page.getByTestId("service-cards")).toBeVisible();
  await page.goto("/dashboard/setup/resources");
  await expect(page.getByTestId("resource-cards")).toBeVisible();
});

test("F-9: clearing the AI assistant name saves (callers hear the default)", async ({ page }) => {
  test.skip(!isLocalSupabaseReachable(), SKIP_REASON);

  await page.goto("/dashboard/agent/greeting");
  const name = page.getByLabel("AI assistant name");
  await name.fill("");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Give your AI assistant a name/)).toHaveCount(0);
  await expect(page.getByText(/Saved/).first()).toBeVisible();
});
