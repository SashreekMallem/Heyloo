import { expect, test } from "@playwright/test";

/**
 * The home page's live demo, up to its failure path (SITE-3). The browser gets a
 * stubbed microphone so the permission step passes, and the demo endpoint is
 * mocked, so no real Retell call is ever placed. The visitor must land on a
 * state that still offers the `/demo` page.
 */
test("live demo: falls back to the demo page when the demo is busy", async ({ page }) => {
  await page.addInitScript(() => {
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => fakeStream },
    });
  });
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
