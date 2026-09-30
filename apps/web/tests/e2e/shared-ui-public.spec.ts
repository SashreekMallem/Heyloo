import { expect, test } from "@playwright/test";

/**
 * Shared-UI smoke coverage that needs no session (QA-1): baseline security
 * headers on every public route (F-08) and the marketing phone menu's
 * Escape handling (F-15). No Supabase, no fixtures.
 */
test.describe("baseline security headers (F-08)", () => {
  for (const route of ["/", "/login", "/pricing"]) {
    test(`${route} sends the hardening headers and hides X-Powered-By`, async ({ request }) => {
      const response = await request.get(route);
      expect(response.status()).toBeLessThan(400);
      const headers = response.headers();
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["permissions-policy"]).toContain("microphone=(self)");
      expect(headers["content-security-policy-report-only"]).toContain("frame-ancestors 'none'");
      expect(headers["x-powered-by"]).toBeUndefined();
    });
  }
});

test.describe("marketing phone menu (F-15)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Escape closes the open menu and returns focus to its toggle", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Open menu" });
    await toggle.click();
    await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
  });
});

test.describe("marketing primary buttons share one token (F-18)", () => {
  test("the signup Continue button is not the app's orange", async ({ page }) => {
    await page.goto("/signup");
    const cta = page.getByRole("button", { name: /continue/i }).first();
    const header = page.locator(".hdr .btn-p").first();
    const [ctaBg, headerBg] = await Promise.all([
      cta.evaluate((el) => getComputedStyle(el).backgroundColor),
      header.evaluate((el) => getComputedStyle(el).backgroundColor),
    ]);
    expect(ctaBg).toBe(headerBg);
  });
});
