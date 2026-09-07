import { expect, test } from "@playwright/test";

/**
 * Admin guard + AAL2 redirect coverage (FRONTEND_SPEC.md §0.1/§0.2,
 * `middleware.ts` guard #1 + `require-admin-session.ts` guard #2).
 *
 * Two tiers, deliberately split by what each actually needs:
 *
 * 1. Unauthenticated redirects (below, in the default project) — pure
 *    "no session cookie" paths exactly like `role-guards.spec.ts`, so they
 *    need no backend and run in every environment including this sandbox.
 *    Extends that spec's bare-`/cockpit` coverage to a couple of nested
 *    cockpit routes, confirming `next=` is preserved for each.
 *
 * 2. The authenticated AAL2 chain (`admin-aal2-authenticated.spec.ts`,
 *    separate file below in this same directory) needs a real platform_admin
 *    session — see that file's own doc comment for what is and isn't
 *    scriptable there.
 */
test.describe("admin guard — unauthenticated redirects", () => {
  test("redirects /cockpit/tenants to /login preserving next", async ({ page }) => {
    await page.goto("/cockpit/tenants");
    await expect(page).toHaveURL(/\/login\?next=%2Fcockpit%2Ftenants/);
  });

  test("redirects /cockpit/margin to /login preserving next", async ({ page }) => {
    await page.goto("/cockpit/margin");
    await expect(page).toHaveURL(/\/login\?next=%2Fcockpit%2Fmargin/);
  });
});
