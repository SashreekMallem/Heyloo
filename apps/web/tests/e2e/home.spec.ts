import { expect, test } from "@playwright/test";

/**
 * Marketing home page smoke coverage (SITE-3). The page is server-rendered
 * text first and the motion runtime only enhances it, so the content checks
 * also run with JavaScript switched off. The live demo is exercised up to its
 * failure path: the browser gets a fake microphone, the demo endpoint is
 * mocked, and no real Retell call is ever placed.
 */
test.describe("home page", () => {
  test("renders the headline, both CTAs and the AI + recording disclosure", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every call, answered.");
    await expect(page.getByRole("link", { name: "Hear a live demo" }).first()).toHaveAttribute(
      "href",
      /#talk$/,
    );
    await expect(page.getByRole("link", { name: "Get started" }).first()).toHaveAttribute(
      "href",
      "/signup",
    );
    const talk = page.locator("#talk");
    await expect(talk.getByText(/talking to an AI assistant/)).toBeAttached();
    await expect(talk.getByText(/recorded/).first()).toBeAttached();
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("still shows the full call transcript, the trades and the pricing", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("#call-script li").first()).toContainText(
        "this call may be recorded",
      );
      await expect(page.locator("article.trade")).toHaveCount(8);
      await expect(page.locator("#pricing")).toBeAttached();
      await expect(
        page.locator("#talk").getByRole("link", { name: /own business/ }),
      ).toBeAttached();
    });
  });

  test("the /demo page still loads", async ({ page }) => {
    const response = await page.goto("/demo");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
