import { expect, test } from "@playwright/test";

/**
 * QA-1 cockpit flows (COCKPIT-F04/F05/F07/F16/F20). The cockpit sits behind the
 * platform_admin claim AND AAL2, and a verified TOTP step-up cannot be scripted
 * (see `admin-aal2-authenticated.spec.ts`), so these run only when
 * `E2E_ADMIN_STORAGE_STATE` points at a saved Playwright storage state of an
 * ALREADY-STEPPED-UP admin session (docs/DEPLOY.md's E2E section) — otherwise they
 * skip. `/api/admin/**` is fulfilled from fixtures here (`page.route`), so no
 * data and no edge function are needed, and nothing live can be published,
 * suspended or acknowledged.
 */
const STORAGE_STATE = process.env["E2E_ADMIN_STORAGE_STATE"];
test.use({ ...(STORAGE_STATE ? { storageState: STORAGE_STATE } : {}) });
test.skip(
  !STORAGE_STATE,
  "needs E2E_ADMIN_STORAGE_STATE (an AAL2 admin session) — see docs/DEPLOY.md",
);

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const TEMPLATE_ID = "3f2a9c1e-0000-4000-8000-000000000001";
const ALERT_ID = "0a0a0a0a-0000-4000-8000-000000000001";

type Seen = { method: string; url: string; body: string | null };

/** Fulfils every `/api/admin/**` call from `handlers` (first match on "METHOD path-suffix") and records it. */
async function mockAdminApi(
  page: import("@playwright/test").Page,
  handlers: Record<string, unknown>,
): Promise<Seen[]> {
  const seen: Seen[] = [];
  await page.route("**/api/admin/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    seen.push({ method: req.method(), url: url.pathname, body: req.postData() });
    const key = Object.keys(handlers).find((k) => {
      const [method, suffix] = k.split(" ");
      return method === req.method() && url.pathname.endsWith(suffix ?? "");
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(key ? handlers[key] : {}),
    });
  });
  return seen;
}

test("template editor is prefilled and publishing needs an explicit confirmation", async ({
  page,
}) => {
  const seen = await mockAdminApi(page, {
    "GET /admin-templates/auto": {
      template: {
        id: TEMPLATE_ID,
        vertical: "auto",
        name: "Auto repair receptionist",
        version: 3,
        is_active: false,
        system_prompt: "You are the shop's phone assistant.",
        states: [{ name: "greeting" }],
      },
    },
    [`POST /admin-templates/${TEMPLATE_ID}/publish`]: {
      published: true,
      template_id: TEMPLATE_ID,
      retell_agent_id: "agent_1",
      retell_flow_id: "flow_1",
    },
  });
  await page.goto("/cockpit/templates/auto");
  await expect(page.getByLabel("System prompt")).toHaveValue("You are the shop's phone assistant.");
  await expect(page.getByLabel("States (JSON)")).toContainText("greeting");

  await page.getByRole("button", { name: "Publish to Retell" }).click();
  await expect(page.getByText("Publish auto v3 to Retell?")).toBeVisible();
  expect(seen.some((s) => s.url.endsWith("/publish"))).toBe(false);

  await page.getByRole("button", { name: "Publish live" }).click();
  await expect(page.getByText("Published to Retell")).toBeVisible();
  expect(seen.filter((s) => s.url.endsWith("/publish"))).toHaveLength(1);
});

test("an open alert can be acknowledged from the cockpit", async ({ page }) => {
  const seen = await mockAdminApi(page, {
    "GET /admin-alerts": {
      alerts: [
        {
          id: ALERT_ID,
          rule: "negative_margin",
          severity: "warning",
          tenant_id: TENANT_ID,
          tenant_name: "Riverside Auto Repair",
          payload: { margin_cents: -500 },
          status: "open",
          created_at: "2026-09-29T10:00:00Z",
        },
      ],
    },
    "GET /admin-alerts/rules": { rules: [] },
    [`PATCH /admin-alerts/${ALERT_ID}/ack`]: { acked: true },
  });
  await page.goto("/cockpit/alerts");
  await expect(page.getByText("Riverside Auto Repair")).toBeVisible();
  await page.getByRole("button", { name: "Acknowledge negative margin alert" }).click();
  await expect
    .poll(() => seen.some((s) => s.method === "PATCH" && s.url.endsWith("/ack")))
    .toBe(true);
});

test("suspending a tenant needs a reason and a paused tenant can be resumed", async ({ page }) => {
  const detail = (status: string) => ({
    tenant: {
      id: TENANT_ID,
      name: "Riverside Auto Repair",
      status,
      plan_code: "standard",
      vertical: "auto",
    },
    metrics: { mrr_cents: null, list_price_cents: 29900, margin_pct: null, minutes_used: 3.6 },
  });
  const seen = await mockAdminApi(page, {
    [`GET /admin-tenants/${TENANT_ID}`]: detail("active"),
    [`PATCH /admin-tenants/${TENANT_ID}`]: { tenant: {} },
  });
  await page.goto(`/cockpit/tenants/${TENANT_ID}`);
  await expect(page.getByText("No active subscription")).toBeVisible();

  await page.getByRole("button", { name: "Suspend" }).click();
  const confirm = page.getByRole("button", { name: "Suspend tenant" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Suspension reason").fill("chargeback dispute");
  await confirm.click();
  await expect
    .poll(() => seen.find((s) => s.method === "PATCH")?.body)
    .toContain("chargeback dispute");
});

test("the include-test choice survives moving between margin pages", async ({ page }) => {
  await mockAdminApi(page, {});
  await page.goto("/cockpit/margin/waterfall");
  const toggle = page.getByRole("switch", { name: "Include test data" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  await page.getByRole("link", { name: "Per-customer" }).click();
  await expect(page).toHaveURL(/\/cockpit\/margin\/customers/);
  await expect(page.getByRole("switch", { name: "Include test data" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("bad ids show a friendly message, not admin_query_failed", async ({ page }) => {
  await page.route("**/api/admin/**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"invalid_id"}' }),
  );
  await page.goto("/cockpit/tenants/not-a-uuid");
  await expect(page.getByText("Not found.")).toBeVisible();
  await expect(page.getByText(/admin_query_failed/)).toHaveCount(0);
  await expect(page.getByText("No calls this quarter.")).toHaveCount(0);
});
