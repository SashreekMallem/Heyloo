import { expect, test } from "@playwright/test";

/**
 * Signup → checkout smoke (FRONTEND_SPEC.md §4.3/§4.4). Seeds the signed
 * pre-auth draft cookie via the real `/api/signup/draft` route (pure HMAC,
 * no external dependency — see docs/BUILD_NOTES.md T5 entry) rather than
 * driving the step-1 form, then jumps straight to step 3 ("Account"): step
 * 2 ("Plan") reads `platform_settings` through a service-role Supabase
 * call that has no reachable project in CI/local smoke runs, so it isn't
 * exercised here — see docs/VERIFY.md.
 *
 * Every remaining network call in this path is browser-originated, so it's
 * mocked at the network boundary: Supabase Auth's `signUp`, then our own
 * `/api/signup/create-tenant` and `/api/checkout/session` Route Handlers,
 * plus the mock checkout destination itself (so the final
 * `window.location.href` redirect has somewhere real to land).
 */
test("signup account step reaches the (mocked) checkout redirect", async ({ page }) => {
  const mockCheckoutUrl = "https://example.com/mock-checkout";

  // Seed the signed draft cookie the same way step 1 would.
  const draftRes = await page.request.post("/api/signup/draft", {
    data: { business_type: "generic", business_name: "Test Co" },
  });
  expect(draftRes.ok()).toBe(true);

  // Supabase Auth `signUp` — mocked so no live Supabase project is needed.
  await page.route("**/auth/v1/signup", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "mock-access-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "mock-refresh-token",
        user: {
          id: "00000000-0000-0000-0000-000000000001",
          email: "owner@example.com",
          app_metadata: {},
          user_metadata: { owner_name: "Test Owner" },
        },
      }),
    });
  });

  // Our own tenant-creation Route Handler.
  await page.route("**/api/signup/create-tenant", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tenant_id: "tenant_mock_1" }),
    });
  });

  // Our own checkout-session Route Handler — the "redirect mock".
  await page.route("**/api/checkout/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: mockCheckoutUrl }),
    });
  });

  // The mocked Stripe-hosted checkout page itself, so the browser's real
  // `window.location.href` navigation lands somewhere instead of erroring.
  await page.route(mockCheckoutUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html><body>Mock checkout</body></html>",
    });
  });

  await page.goto("/signup/account");

  await page.getByLabel("Your name").fill("Test Owner");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple 1");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account & continue" }).click();

  await page.waitForURL(mockCheckoutUrl);
  await expect(page.getByText("Mock checkout")).toBeVisible();
});
