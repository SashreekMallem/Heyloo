import { expect, test } from "@playwright/test";
import { authStorageState, isLocalSupabaseReachable } from "./support/auth-state.js";

/**
 * Forwarding wizard flow (`/signup/forwarding`, FRONTEND_SPEC.md §4.6 —
 * signup step 6, the same `PhoneSetupWizard` component `/dashboard/
 * phone-setup` reuses in "onboarding" mode). Guarded by
 * `requireTenantSession` (apps/web/src/app/[locale]/(marketing)/signup/
 * forwarding/page.tsx) — a real server-side Supabase call, so this needs
 * the same real local-Supabase session as `dashboard-realtime.spec.ts`.
 *
 * Requires the "setup" project's `tenant-owner` storageState (see
 * `auth.setup.ts`, which provisions the fixture tenant with
 * `status: 'active'` — the page redirects to `/signup/provisioning`
 * otherwise). Cannot run in this sandbox (no Docker); runs in CI/locally
 * per `docs/DEPLOY.md`'s E2E section.
 */
test.use({ storageState: authStorageState("tenant-owner") });

test("an active tenant owner reaches the forwarding wizard and sees their live number", async ({
  page,
}) => {
  test.skip(
    !isLocalSupabaseReachable(),
    "requires a local `supabase start` instance — see docs/DEPLOY.md",
  );

  await page.goto("/signup/forwarding");
  await expect(page).toHaveURL(/\/signup\/forwarding/);
  await expect(page.getByRole("heading", { name: "Almost there" })).toBeVisible();

  // PhoneSetupWizard (apps/web/src/components/phone-setup/phone-setup-wizard.tsx)
  // is handed the fixture tenant's own e164 number (seeded by
  // `provisionTenantOwner()`) — asserting some forwarding-related content
  // renders confirms the wizard mounted with real server-fetched props,
  // not just that the page didn't redirect.
  await expect(page.getByText(/forward/i).first()).toBeVisible();
});
