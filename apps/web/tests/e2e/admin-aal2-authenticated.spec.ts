import { expect, test } from "@playwright/test";
import { authStorageState, isLocalSupabaseReachable } from "./support/auth-state.js";

/**
 * The authenticated leg of the admin guard (`require-admin-session.ts`):
 * platform_admin claim confirmed -> no verified TOTP factor yet ->
 * `/mfa/enroll`. This is the one AAL2-adjacent branch that's actually
 * scriptable without also programmatically enrolling and verifying a real
 * TOTP factor (generating a valid 6-digit code from a freshly-enrolled
 * secret, entirely in-script, is a heavier lift than this spec's value
 * justifies) — a freshly-provisioned `platform_admins` row has no factor by
 * construction, so this is real coverage of a real, common state (every
 * admin account starts here), not a placeholder.
 *
 * The remaining branch — a verified factor but an AAL1 (not yet stepped-up)
 * session, which should redirect to `/mfa/challenge?next=...` — needs an
 * actual enrolled TOTP secret to drive, which is a manual staging check
 * instead: see `docs/DEPLOY.md`'s go-live smoke checklist ("MFA step-up").
 *
 * Requires the "setup" project's `platform-admin-no-mfa` storageState (see
 * `auth.setup.ts`) — a reachable local `supabase start` instance. Cannot
 * run in this sandbox (no Docker); runs in CI/locally per
 * `docs/DEPLOY.md`'s E2E section.
 */
test.use({ storageState: authStorageState("platform-admin-no-mfa") });

test("a platform_admin with no verified MFA factor is sent to /mfa/enroll, not /cockpit", async ({
  page,
}) => {
  test.skip(
    !isLocalSupabaseReachable(),
    "requires a local `supabase start` instance — see docs/DEPLOY.md",
  );

  await page.goto("/cockpit");
  await expect(page).toHaveURL(/\/mfa\/enroll/);
});

test("the redirect also fires for a nested cockpit route, not just the root", async ({ page }) => {
  test.skip(
    !isLocalSupabaseReachable(),
    "requires a local `supabase start` instance — see docs/DEPLOY.md",
  );

  await page.goto("/cockpit/tenants");
  await expect(page).toHaveURL(/\/mfa\/enroll/);
});
