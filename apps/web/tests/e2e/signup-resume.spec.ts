import { expect, test } from "@playwright/test";

/**
 * SIGNUP-BILL-FIX A + B, browser level. Like `signup-checkout.spec.ts`, every
 * network call to Supabase Auth / Stripe is mocked at the browser boundary so
 * no live project is needed; the signed draft cookie is seeded through the real
 * `/api/signup/draft` route.
 *
 * What this proves in a real browser:
 *  - the account form shows GoTrue's real error (mapped by error code) instead
 *    of "Something went wrong";
 *  - with email confirmation on (no session returned) the wizard says "Check
 *    your email" instead of dead-ending, and the signUp request carries
 *    `emailRedirectTo` (-> /auth/confirm?next=/signup/resume) plus the wizard
 *    state in the user metadata;
 *  - the signup draft cookie SURVIVES the trip to checkout: after the checkout
 *    step and a cancel at Stripe (browser back to the app), the draft-guarded
 *    pages still render instead of bouncing to a blank step 1.
 * That the checkout Route Handler itself no longer deletes the cookie is
 * asserted in `src/app/api/checkout/session/route.test.ts` (it needs a real
 * Supabase session, which this spec deliberately does not have).
 */

const GOTRUE_SIGNUP = /\/auth\/v1\/signup/;

async function seedDraft(page: import("@playwright/test").Page) {
  const res = await page.request.post("/api/signup/draft", {
    data: { business_type: "auto", business_name: "Joe's Garage" },
  });
  expect(res.ok()).toBe(true);
}

async function fillAccountForm(page: import("@playwright/test").Page) {
  await page.getByLabel("Your name").fill("Joe Owner");
  await page.getByLabel("Email").fill("joe@joesgarage.com");
  await page.getByLabel("Password").fill("correct horse battery staple 1");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account & continue" }).click();
}

test.describe("signup error mapping", () => {
  const cases: {
    name: string;
    status: number;
    body: Record<string, unknown>;
    expected: RegExp;
  }[] = [
    {
      name: "email_address_invalid",
      status: 422,
      body: { code: 422, error_code: "email_address_invalid", msg: "Email address is invalid" },
      expected: /can't be used.*business email/i,
    },
    {
      name: "weak_password",
      status: 422,
      body: {
        code: 422,
        error_code: "weak_password",
        msg: "Password should be at least 8 characters",
        weak_password: { reasons: ["length"] },
      },
      expected: /stronger password.*too short/i,
    },
    {
      name: "over_email_send_rate_limit",
      status: 429,
      body: {
        code: 429,
        error_code: "over_email_send_rate_limit",
        msg: "email rate limit exceeded",
      },
      expected: /too many confirmation emails/i,
    },
    {
      name: "signup_disabled",
      status: 403,
      body: {
        code: 403,
        error_code: "signup_disabled",
        msg: "Signups not allowed for this instance",
      },
      expected: /temporarily closed/i,
    },
    {
      name: "user_already_exists",
      status: 422,
      body: { code: 422, error_code: "user_already_exists", msg: "User already registered" },
      expected: /already registered/i,
    },
  ];

  for (const c of cases) {
    test(`shows a clear message for ${c.name}`, async ({ page }) => {
      await seedDraft(page);
      await page.route(GOTRUE_SIGNUP, (route) =>
        route.fulfill({
          status: c.status,
          contentType: "application/json",
          body: JSON.stringify(c.body),
        }),
      );
      await page.goto("/signup/account");
      await fillAccountForm(page);
      await expect(page.getByText(c.expected)).toBeVisible();
      await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
    });
  }
});

test("email confirmation on: shows check-your-email and sends the redirect + wizard state", async ({
  page,
}) => {
  await seedDraft(page);
  let signUpBody: {
    data?: Record<string, unknown>;
    gotrue_meta_security?: unknown;
  } & Record<string, unknown> = {};
  let signUpUrl = "";
  await page.route(GOTRUE_SIGNUP, async (route) => {
    signUpBody = route.request().postDataJSON();
    signUpUrl = route.request().url();
    // GoTrue with confirmations on: a user, no session.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "00000000-0000-0000-0000-000000000002",
        email: "joe@joesgarage.com",
        identities: [{ provider: "email" }],
        app_metadata: {},
        user_metadata: {},
      }),
    });
  });

  await page.goto("/signup/account?white_glove=1");
  await fillAccountForm(page);

  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByText("joe@joesgarage.com")).toBeVisible();
  await expect(page.getByRole("button", { name: /resend/i })).toBeVisible();

  expect(signUpBody.data).toMatchObject({
    owner_name: "Joe Owner",
    signup_draft: { business_type: "auto", business_name: "Joe's Garage" },
    signup_plan: { annual: false, white_glove: true },
  });
  const redirectTo = new URL(signUpUrl).searchParams.get("redirect_to");
  expect(redirectTo).toContain("/auth/confirm?next=%2Fsignup%2Fresume");
});

test("the signup draft survives checkout and a cancel at Stripe (no blank step 1)", async ({
  page,
  context,
}) => {
  const mockCheckoutUrl = "https://example.com/mock-checkout";
  await seedDraft(page);

  await page.route(GOTRUE_SIGNUP, (route) =>
    route.fulfill({
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
          email: "joe@joesgarage.com",
          identities: [{ provider: "email" }],
          app_metadata: {},
          user_metadata: {},
        },
      }),
    }),
  );
  await page.route("**/api/checkout/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: mockCheckoutUrl }),
    }),
  );
  await page.route(mockCheckoutUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html><body>Mock Stripe</body></html>",
    }),
  );

  await page.goto("/signup/account");
  await fillAccountForm(page);
  await page.waitForURL(mockCheckoutUrl);

  // The customer cancels at Stripe and comes back to the app.
  const cookies = await context.cookies();
  expect(cookies.some((c) => c.name === "heyloo_signup_draft")).toBe(true);
  const back = await page.goto("/signup/account");
  expect(back?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/signup\/account$/);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();

  // /signup/plan is guarded by the same draft: it must not bounce to /signup.
  await page.goto("/signup/plan", { waitUntil: "commit" });
  await expect(page).not.toHaveURL(/\/signup\/?$/);
});

test("without any draft the guarded steps still send the visitor to step 1", async ({ page }) => {
  await page.goto("/signup/account");
  await expect(page).toHaveURL(/\/signup\/?$/);
});
