import { expect, test as setup } from "@playwright/test";
import { isLocalSupabaseReachable } from "./support/auth-state.js";
import {
  provisionPlatformAdminNoMfa,
  provisionTenantOwner,
} from "./support/provision-test-users.js";

/**
 * Playwright "setup project" (the pattern Playwright's own docs recommend
 * for auth: https://playwright.dev/docs/auth — one real login per role,
 * `storageState` reused by every dependent spec) rather than logging in
 * inside each spec. Drives the REAL `/login` form in a REAL browser against
 * a REAL local Supabase instance — never a fabricated cookie — so whatever
 * `@supabase/ssr` actually does with the session is exercised faithfully.
 *
 * Only runs when a local Supabase stack is reachable (`E2E_SUPABASE_URL` /
 * `SUPABASE_URL` set — see `support/provision-test-users.ts` and
 * `docs/DEPLOY.md`'s E2E section). Every dependent spec below is written to
 * run for real in that environment (CI with `supabase start`, or a
 * developer's machine) but CANNOT execute in this sandbox (no Docker — see
 * `docs/BUILD_NOTES.md`'s T9 entry) and is not part of the default
 * `pnpm --filter web run test:e2e` CI job for that reason — see
 * `playwright.config.ts`'s "auth" project and `.github/workflows/ci.yml`'s
 * `e2e` job, which only runs the unauthenticated projects.
 */
const authReady = isLocalSupabaseReachable();
const SKIP_REASON = "requires a local `supabase start` instance — see docs/DEPLOY.md";

setup("authenticate as a tenant owner", async ({ page }) => {
  setup.skip(!authReady, SKIP_REASON);
  const owner = await provisionTenantOwner();

  await page.goto("/login");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Log in" }).click();

  await page.waitForURL(/\/dashboard/);
  await expect(page.getByRole("heading").first()).toBeVisible();

  await page.context().storageState({ path: "playwright/.auth/tenant-owner.json" });
});

setup("authenticate as a platform admin (no MFA factor yet)", async ({ page }) => {
  setup.skip(!authReady, SKIP_REASON);
  const admin = await provisionPlatformAdminNoMfa();

  await page.goto("/login");
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByRole("button", { name: "Log in" }).click();

  // requireAdminSession redirects a platform_admin with no verified TOTP
  // factor to /mfa/enroll (apps/web/src/lib/auth/require-admin-session.ts)
  // — reaching that page IS the successful outcome for this fixture.
  await page.waitForURL(/\/mfa\/enroll/);

  await page.context().storageState({ path: "playwright/.auth/platform-admin-no-mfa.json" });
});
