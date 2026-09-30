import { expect, test } from "@playwright/test";

/**
 * QA-1-auth regression coverage for the anonymous-visitor side of the auth
 * flows (AUTH-04/06/09/10/12/13, MAP-08/09). Needs no reachable Supabase: the
 * one place the browser would talk to it (the password grant) is intercepted
 * with `page.route`, and every other assertion is on server redirects, static
 * markup or response headers. The signed-in behaviours (bounce off /login,
 * /no-access, AAL2 step-up) are covered by the unit suites and by
 * `admin-aal2-authenticated.spec.ts` when a local Supabase is reachable.
 */
test.describe("security headers (AUTH-13)", () => {
  test("the login page cannot be framed and is not MIME-sniffed", async ({ request }) => {
    const res = await request.get("/login");
    const headers = res.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("the embeddable widget bundle stays frameable-agnostic (no anti-framing rule)", async ({
    request,
  }) => {
    const res = await request.get("/widget.js");
    expect(res.headers()["x-frame-options"]).toBeUndefined();
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });
});

test.describe("deep links (AUTH-12)", () => {
  test("keeps the full path and query in next, and no stray params", async ({ page }) => {
    await page.goto("/dashboard/billing?x=1");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fbilling%3Fx%3D1$/);
  });

  test("an anonymous visitor to /no-access is sent to log in", async ({ page }) => {
    await page.goto("/no-access");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("login page", () => {
  test("has a main landmark and a labelled form (MAP-08)", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  });

  test("explains a failed or expired email link (AUTH-04)", async ({ page }) => {
    await page.goto("/login?toast=confirm_failed");
    await expect(
      page.getByRole("alert").filter({ hasText: "invalid or has expired" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Forgot your password?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New here? Start free" })).toBeVisible();
  });

  test("a rate-limited login says so, announces it, and sends one request for three clicks (AUTH-06, MAP-09)", async ({
    page,
  }) => {
    let tokenCalls = 0;
    await page.route("**/auth/v1/token**", async (route) => {
      tokenCalls += 1;
      await new Promise((r) => setTimeout(r, 600));
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          code: 429,
          error_code: "over_request_rate_limit",
          msg: "Request rate limit reached",
        }),
      });
    });
    await page.goto("/login");
    await page.getByLabel("Email").fill("member@example.com");
    await page.getByLabel("Password").fill("correct-horse-battery");
    const submit = page.getByRole("button", { name: "Log in" });
    await submit.click();
    await submit.click({ force: true, timeout: 500 }).catch(() => {});
    await submit.click({ force: true, timeout: 500 }).catch(() => {});
    await expect(page.getByRole("alert").filter({ hasText: "Too many attempts" })).toBeVisible();
    expect(tokenCalls).toBe(1);
  });

  test("a network failure reads as a connection problem, not wrong credentials (AUTH-06)", async ({
    page,
  }) => {
    await page.route("**/auth/v1/token**", (route) => route.abort("connectionrefused"));
    await page.goto("/login");
    await page.getByLabel("Email").fill("member@example.com");
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Connection problem" })).toBeVisible();
  });
});

test.describe("password reset (AUTH-04, AUTH-10, MAP-20)", () => {
  test("a failed recovery link lands on the reset form with an expiry notice", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=bad&type=recovery&next=%2Freset-password%2Fconfirm");
    await expect(page).toHaveURL(/\/reset-password\?error=expired$/);
    await expect(
      page.getByRole("alert").filter({ hasText: "invalid or has expired" }),
    ).toBeVisible();
  });

  test("the request form offers a way back to log in", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByRole("link", { name: "Back to log in" })).toBeVisible();
  });

  test("opening the confirm page with no recovery session shows the expired-link card up front", async ({
    page,
  }) => {
    await page.goto("/reset-password/confirm");
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Request a new link" })).toBeVisible();
    await expect(page.getByLabel("New password")).toHaveCount(0);
  });
});
