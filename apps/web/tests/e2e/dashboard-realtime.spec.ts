import { expect, test } from "@playwright/test";
import { authStorageState, isLocalSupabaseReachable } from "./support/auth-state.js";

/**
 * Dashboard realtime update simulation (FRONTEND_SPEC.md's tenant-scoped
 * broadcast + `TenantRealtimeProvider`, BUILD_NOTES.md's T5 entry — already
 * unit-tested with a mocked channel; this is the missing end-to-end leg:
 * a REAL Postgres write fanning out through the REAL tenant-scoped
 * `realtime.messages` broadcast to a REAL browser tab).
 *
 * Requires the "setup" project's `tenant-owner` storageState (see
 * `auth.setup.ts`) — i.e. a reachable local `supabase start` instance.
 * Cannot run in this sandbox (no Docker); designed to run in CI/locally per
 * `docs/DEPLOY.md`'s E2E section. `test.skip()` below makes that explicit
 * rather than failing opaquely when the precondition isn't met.
 */
test.use({ storageState: authStorageState("tenant-owner") });

test("a new call_logs row appears on the calls list without a page reload", async ({ page }) => {
  test.skip(
    !isLocalSupabaseReachable(),
    "requires a local `supabase start` instance — see docs/DEPLOY.md",
  );

  // `/dashboard/calls` (CallsListClient, apps/web/src/components/tenant/
  // calls-list-client.tsx) renders `caller_number` verbatim in its
  // "Customer" column via `useTenantQuery` — the same hook
  // `TenantRealtimeProvider`'s broadcast invalidates — so a raw phone
  // number is a real, stable string to assert on, not a guessed selector.
  await page.goto("/dashboard/calls");
  // Guard #2 ((tenant) layout) already ran server-side by the time this
  // resolves — a redirect back to /login would mean the storageState
  // session didn't stick, which is itself worth failing loudly on rather
  // than silently asserting on a login page.
  await expect(page).toHaveURL(/\/dashboard\/calls/);

  // Read this session's own tenant id straight from the JWT the page just
  // authenticated with, via the same Supabase publishable-key session the
  // browser holds — avoids a second, separate service-role lookup drifting
  // from whichever tenant `auth.setup.ts` actually provisioned.
  const tenantId = await page.evaluate(async () => {
    const raw = Object.entries(localStorage).find(([key]) => key.endsWith("-auth-token"));
    if (!raw) return null;
    try {
      const session = JSON.parse(raw[1]);
      const claims = JSON.parse(atob(session.access_token.split(".")[1] ?? ""));
      return claims.app_metadata?.tenant_id ?? null;
    } catch {
      return null;
    }
  });
  test.skip(!tenantId, "could not read tenant_id from the authenticated session's JWT");

  const supabaseUrl = process.env["SUPABASE_URL"]?.replace(/\/$/, "");
  const serviceKey = process.env["SUPABASE_SECRET_KEY"] ?? "";
  const retellCallId = `pw-realtime-${Date.now()}`;
  // A number unlikely to collide with any other seeded/fixture row this
  // tenant might already have.
  const callerNumber = `+1555${Date.now().toString().slice(-7)}`;

  // The realtime broadcast fires from a trigger on INSERT (fn_broadcast_
  // tenant_update, supabase/migrations/20260907131400_functions_triggers.sql)
  // — a plain service-role REST insert exercises the real trigger path,
  // not a hand-rolled broadcast call.
  const insertRes = await page.request.post(`${supabaseUrl}/rest/v1/call_logs`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    data: {
      tenant_id: tenantId,
      retell_call_id: retellCallId,
      caller_number: callerNumber,
      direction: "inbound",
      started_at: new Date().toISOString(),
    },
  });
  expect(insertRes.ok()).toBe(true);

  // The realtime-driven refetch is asynchronous (broadcast -> client
  // invalidateQueries -> refetch -> render) — poll with Playwright's own
  // auto-retrying locator assertion rather than a fixed sleep.
  await expect(page.getByText(callerNumber)).toBeVisible({ timeout: 15_000 });
});
