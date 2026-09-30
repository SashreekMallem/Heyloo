import { expect, test } from "@playwright/test";

/**
 * Referral attribution capture (PT-01). A partner's link is
 * `/signup?ref=CODE`; the middleware must persist it in a first-party httpOnly
 * cookie so `POST /api/checkout/session` can forward it to `api-checkout`
 * (which writes `tenants.referrer_partner_id` + the pending `referrals` row —
 * covered by the edge-function unit tests). Pure request/response, so it runs
 * with no Supabase project.
 */
const REF_COOKIE = "heyloo_ref";
const NINETY_DAYS_SECONDS = 60 * 60 * 24 * 90;

test("a partner link sets the httpOnly attribution cookie (upper-cased, 90 days)", async ({
  page,
}) => {
  await page.goto("/signup?ref=abcd2345");

  const cookie = (await page.context().cookies()).find((c) => c.name === REF_COOKIE);
  expect(cookie).toBeDefined();
  expect(cookie?.value).toBe("ABCD2345");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");

  const lifetime = (cookie?.expires ?? 0) - Date.now() / 1000;
  expect(lifetime).toBeGreaterThan(NINETY_DAYS_SECONDS - 120);
  expect(lifetime).toBeLessThanOrEqual(NINETY_DAYS_SECONDS + 5);

  // Never readable from page script.
  expect(await page.evaluate(() => document.cookie)).not.toContain(REF_COOKIE);
});

test("a malformed ref is ignored", async ({ page }) => {
  await page.goto("/signup?ref=%3Cscript%3E");
  const cookie = (await page.context().cookies()).find((c) => c.name === REF_COOKIE);
  expect(cookie).toBeUndefined();
});

test("the cookie survives navigation through the signup steps", async ({ page }) => {
  await page.goto("/signup?ref=ABCD2345");
  await page.goto("/signup/account");
  const cookie = (await page.context().cookies()).find((c) => c.name === REF_COOKIE);
  expect(cookie?.value).toBe("ABCD2345");
});

for (const path of ["/?ref=abc123", "/pricing?ref=abc123"]) {
  test(`a partner link on ${path.split("?")[0]} sets the cookie`, async ({ page }) => {
    await page.goto(path);
    const cookie = (await page.context().cookies()).find((c) => c.name === REF_COOKIE);
    expect(cookie?.value).toBe("ABC123");
  });
}

test("an empty ?ref= sets no cookie", async ({ page }) => {
  await page.goto("/?ref=");
  const cookie = (await page.context().cookies()).find((c) => c.name === REF_COOKIE);
  expect(cookie).toBeUndefined();
});
