import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke specs run headless per BUILD_PLAN — signup→checkout redirect mock,
 * role-guard redirects (CLAUDE.md/T5 task), plus T9's authenticated flows
 * (dashboard realtime, admin AAL2, forwarding wizard). Against a locally
 * built+started Next server (see package.json `webServer`).
 *
 * Two projects, Playwright's own recommended auth pattern
 * (https://playwright.dev/docs/auth): "setup" runs `auth.setup.ts` once,
 * which — ONLY when a local `supabase start` instance is reachable
 * (`SUPABASE_URL`/`SUPABASE_SECRET_KEY` set) — provisions real test users
 * and logs each in through the real `/login` form, saving `storageState`
 * under `playwright/.auth/`; every spec in "chromium" then either uses one
 * of those files (the authenticated specs, via their own file-level
 * `test.use({ storageState: ... })`) or runs with no stored session at all
 * (the pre-auth specs — role-guards, signup-checkout, admin-aal2's
 * unauthenticated half). When no local Supabase is reachable, "setup"'s own
 * tests self-skip (see `auth.setup.ts`) rather than failing the
 * `dependencies` chain, so the unauthenticated specs still run standalone —
 * this is the mode this sandbox and a plain `pnpm test:e2e` run in (see
 * docs/BUILD_NOTES.md's T9 entry and docs/DEPLOY.md's E2E section for how
 * to run the full authenticated suite for real).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
  },
});
