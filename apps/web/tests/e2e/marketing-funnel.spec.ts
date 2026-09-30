import { expect, test } from "@playwright/test";

/**
 * QA-1 marketing-funnel regressions, browser level. Everything that would
 * touch Supabase or the edge functions is mocked at the browser boundary, so
 * no live project is needed.
 */

test.describe("crawler files (F-09, SEC-20)", () => {
  test("robots.txt disallows the app surfaces and points at the sitemap", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("Disallow: /dashboard");
    expect(body).toContain("Disallow: /api/");
    expect(body).toMatch(/Sitemap: https?:\/\/.+\/sitemap\.xml/);
  });

  test("sitemap.xml lists the marketing pages", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("/pricing");
    expect(body).toContain("/auto-repair");
    expect(body).toContain("/legal/terms");
  });

  test("rss.xml is served as RSS, not rewritten to /en/rss.xml", async ({ request }) => {
    const res = await request.get("/rss.xml", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("rss+xml");
  });

  test("a 404 has a title and pages have descriptions", async ({ page }) => {
    await page.goto("/definitely-not-a-page");
    await expect(page).toHaveTitle(/not found/i);
    for (const path of ["/blog", "/legal/terms", "/signup"]) {
      await page.goto(path);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{20,}/);
    }
  });
});

test.describe("marketing header (MAP-16, F-13)", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("Escape closes the mobile menu and returns focus to the menu button", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.locator("#mobile-nav")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#mobile-nav")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
  });

  test("a visitor with a session cookie sees Open dashboard instead of Get started", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "sb-e2e-auth-token", value: "base64-x", url: baseURL ?? "http://127.0.0.1:3100" },
    ]);
    await page.goto("/pricing");
    const header = page.locator("header.hdr");
    await expect(header.getByRole("link", { name: "Open dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    await expect(header.getByRole("link", { name: "Get started" })).toHaveCount(0);
  });
});

test.describe("signup step 1 (F-12)", () => {
  test("shows an error, not a dead button, when the draft can't be saved", async ({ page }) => {
    await page.route("**/api/signup/draft", (route) =>
      route.fulfill({ status: 500, json: { error: "boom" } }),
    );
    await page.goto("/signup");
    await page.getByLabel("Business name").fill("Joe's Garage");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(/couldn't save your details/i)).toBeVisible();
  });

  test("Back from a later step keeps the business name and selection", async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("button", { name: /dental/i }).click();
    await page.getByLabel("Business name").fill("Bright Smiles");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/signup/plan");
    await page.goto("/signup");
    await expect(page.getByLabel("Business name")).toHaveValue("Bright Smiles");
    await expect(page.getByRole("button", { name: /dental/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

test.describe("demo confirm step (F-10, F-11)", () => {
  test("does not auto-activate, sends the edited values, and offers no fake email capture", async ({
    page,
  }) => {
    let confirmBody: { edits?: { business_name?: string } } | undefined;
    let confirmCalls = 0;
    await page.route("**/api/demo/generate", (route) =>
      route.fulfill({
        json: {
          demo_session_id: "0b0a3f8e-5c1a-4f57-9a44-0d6c3b1d9a11",
          needs_confirmation: true,
          agent_summary: {
            business_name: "Acme Auto",
            hours_detected: "Mon-Fri 8-5",
            services_detected: ["Oil change"],
          },
        },
      }),
    );
    await page.route("**/api/demo/confirm", (route) => {
      confirmCalls += 1;
      confirmBody = route.request().postDataJSON();
      return route.fulfill({
        json: {
          retell_call_token: "tok",
          agent_summary: {
            business_name: "Acme Motors",
            hours_detected: "",
            services_detected: [],
          },
        },
      });
    });

    await page.goto("/demo");
    await page.getByLabel("Business name").fill("Acme Auto");
    await page.getByLabel("Website URL").fill("https://acme.example");
    await page.getByRole("button", { name: "Build my demo agent" }).click();
    await expect(page.getByText(/anything wrong\?/)).toBeVisible();

    await page.getByLabel("Business name").fill("Acme Motors");
    await page.waitForTimeout(9_000);
    expect(confirmCalls).toBe(0);

    await page.getByRole("button", { name: /looks good/i }).click();
    await expect(page.getByText(/AI receptionist is ready/)).toBeVisible();
    expect(confirmBody?.edits?.business_name).toBe("Acme Motors");
    await expect(page.getByText(/email me this demo/i)).toHaveCount(0);
  });
});
