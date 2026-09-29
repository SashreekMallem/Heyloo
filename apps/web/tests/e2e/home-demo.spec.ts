import { expect, type Page, test } from "@playwright/test";

/**
 * The home page's live demo, up to its failure paths (SITE-3, DEMO-2). The
 * browser gets a stubbed microphone so the permission step passes, and the demo
 * endpoint is mocked, so no real Retell call is ever placed. The visitor must
 * land on a state that says what happened and still offers the `/demo` page.
 */
async function stubMicrophone(page: Page) {
  await page.addInitScript(() => {
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => fakeStream },
    });
  });
}

test("live demo: falls back to the demo page when the demo is busy", async ({ page }) => {
  await stubMicrophone(page);
  await page.route("**/api/demo/instant", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: "rate_limited" }),
    }),
  );
  await page.goto("/");
  const talk = page.locator("#talk");
  await expect(talk.getByText(/talking to an AI assistant/)).toBeAttached();
  // a click that lands before React has hydrated is lost, so retry until the state moves
  await expect(async () => {
    await talk.getByRole("button", { name: /Talk to Heyloo/ }).click({ timeout: 1000 });
    await expect(talk.getByRole("status")).toContainText(/lot of people/, { timeout: 1500 });
  }).toPass({ timeout: 10_000 });
  await expect(talk.getByRole("link", { name: /own business/ })).toHaveAttribute("href", /\/demo$/);
  await expect(talk.getByRole("button", { name: "Talk again" })).toBeVisible();
});

test("live demo: asks for the business type the visitor picked, and says when it is not available", async ({
  page,
}) => {
  await stubMicrophone(page);
  const requested: unknown[] = [];
  await page.route("**/api/demo/instant", (route) => {
    requested.push(route.request().postDataJSON());
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "demo_unavailable" }),
    });
  });
  await page.goto("/");
  const talk = page.locator("#talk");
  // hydration can swallow the first interactions, so retry the whole pick-and-talk
  await expect(async () => {
    await talk.getByRole("radio", { name: "Dental" }).check({ timeout: 1000 });
    await expect(talk.getByRole("radio", { name: "Dental" })).toBeChecked({ timeout: 500 });
    await talk.getByRole("button", { name: /Talk (to Heyloo|again)/ }).click({ timeout: 1000 });
    await expect(talk.getByRole("status")).toContainText(/Dental demo isn’t available right now/, {
      timeout: 1500,
    });
  }).toPass({ timeout: 10_000 });
  expect(requested.at(-1)).toEqual({ vertical: "dental" });
  await expect(talk.getByRole("link", { name: /own business/ })).toHaveAttribute("href", /\/demo$/);
});
