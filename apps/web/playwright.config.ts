import { defineConfig, devices } from "@playwright/test";

/** Smoke specs run headless per BUILD_PLAN — signup→checkout redirect mock, role-guard redirects (CLAUDE.md/T5 task). Against a locally built+started Next server (see package.json `webServer`). */
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
  },
});
