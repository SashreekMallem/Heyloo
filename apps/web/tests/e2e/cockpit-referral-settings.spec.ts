import { expect, test } from "@playwright/test";

/**
 * COCKPIT-F06 (QA-2): Settings > Referral. Runs only against an already
 * stepped-up (AAL2) admin storage state (same gate as `cockpit-qa1.spec.ts`);
 * `/api/admin/**` is fulfilled from fixtures, so nothing live is read or written.
 */
const STORAGE_STATE = process.env["E2E_ADMIN_STORAGE_STATE"];
test.use({ ...(STORAGE_STATE ? { storageState: STORAGE_STATE } : {}) });
test.skip(
  !STORAGE_STATE,
  "needs E2E_ADMIN_STORAGE_STATE (an AAL2 admin session) — see docs/DEPLOY.md",
);

async function mockSettings(page: import("@playwright/test").Page, referral: unknown) {
  const writes: string[] = [];
  await page.route("**/api/admin/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== "GET") writes.push(`${req.method()} ${path}`);
    const body = path.endsWith("/fees") ? { fees: {} } : { referral, price_cards: {} };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return writes;
}

test("the stored referral amount is shown as $200.00", async ({ page }) => {
  await mockSettings(page, {
    flat_amount_cents: 20000,
    qualification_rule: "paid_invoices_gte",
    qualification_value: 2,
  });
  await page.goto("/cockpit/settings");
  await expect(page.getByLabel("Flat referral amount")).toHaveValue("200.00");
});

test("a response from a not-yet-redeployed admin function shows no $0.00 form and cannot save", async ({
  page,
}) => {
  // The old function answers with no `qualification_value` and 0 for the seeded amount.
  const writes = await mockSettings(page, { flat_amount_cents: 0, qualification_rule: "" });
  await page.goto("/cockpit/settings");
  await expect(page.getByText(/referral settings are unavailable/i)).toBeVisible();
  await expect(page.getByLabel("Flat referral amount")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
});
