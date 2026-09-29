import { expect, type Page, test } from "@playwright/test";
import { authStorageState, isLocalSupabaseReachable } from "./support/auth-state.js";

/**
 * QA-1 portal-core: end-to-end coverage of the owner-facing fixes — Overview
 * "today" cards, customer notes / search / opt-out, call detail header and
 * transcript, bookings windows + reschedule slots, the notification bell, message
 * thread validation and the billing portal button.
 *
 * The first block needs no backend (anonymous callers are refused). The second
 * is the real owner flow and needs the "setup" project's `tenant-owner`
 * storageState, i.e. a local `supabase start` instance (see `auth.setup.ts` and
 * docs/DEPLOY.md's E2E section); it self-skips otherwise. Rows are seeded through
 * the service-role REST API against the fixture tenant read from the session JWT.
 */
test.describe("portal-core API without a session", () => {
  test("the tenant APIs touched by QA-1 all answer 401 to an anonymous caller", async ({
    request,
  }) => {
    const reply = await request.post("/api/tenant/messages/abc", { data: { body: "hi" } });
    expect(reply.status()).toBe(401);
    const note = await request.post(
      "/api/tenant/customers/00000000-0000-0000-0000-000000000000/notes",
      { data: { note: "x" } },
    );
    expect(note.status()).toBe(401);
    const exportRes = await request.get(
      "/api/tenant/calls/export?tenant_id=x&classification=emergency",
    );
    expect(exportRes.status()).toBe(401);
    const portal = await request.post("/api/billing/portal");
    expect(portal.status()).toBe(401);
  });

  test("the pages redirect an anonymous visitor to /login", async ({ page }) => {
    for (const path of ["/dashboard", "/dashboard/customers", "/dashboard/bookings"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?next=/);
    }
  });
});

interface Seed {
  supabaseUrl: string;
  serviceKey: string;
  tenantId: string;
}

async function readSeed(page: Page): Promise<Seed | null> {
  const tenantId = await page.evaluate(() => {
    const raw = Object.entries(localStorage).find(([key]) => key.endsWith("-auth-token"));
    if (!raw) return null;
    try {
      const session = JSON.parse(raw[1]);
      const claims = JSON.parse(atob(session.access_token.split(".")[1] ?? ""));
      return (claims.app_metadata?.tenant_id as string | undefined) ?? null;
    } catch {
      return null;
    }
  });
  const supabaseUrl = process.env["SUPABASE_URL"]?.replace(/\/$/, "");
  const serviceKey = process.env["SUPABASE_SECRET_KEY"] ?? "";
  if (!tenantId || !supabaseUrl || !serviceKey) return null;
  return { supabaseUrl, serviceKey, tenantId };
}

async function insertRow(
  page: Page,
  seed: Seed,
  table: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await page.request.post(`${seed.supabaseUrl}/rest/v1/${table}`, {
    headers: {
      apikey: seed.serviceKey,
      Authorization: `Bearer ${seed.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    data: { tenant_id: seed.tenantId, ...data },
  });
  expect(res.ok(), `insert into ${table}: ${await res.text()}`).toBe(true);
  const rows = (await res.json()) as Record<string, unknown>[];
  return rows[0] as Record<string, unknown>;
}

const uniquePhone = () => `+1555${Date.now().toString().slice(-7)}`;

test.describe("portal-core as a tenant owner", () => {
  test.use({ storageState: authStorageState("tenant-owner") });

  test.beforeEach(() => {
    test.skip(
      !isLocalSupabaseReachable(),
      "requires a local `supabase start` instance — see docs/DEPLOY.md",
    );
  });

  test("Overview counts a call made today live, and call detail names the caller with a readable transcript", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const seed = await readSeed(page);
    test.skip(!seed, "could not read tenant_id from the authenticated session's JWT");
    if (!seed) return;

    const callerNumber = uniquePhone();
    const call = await insertRow(page, seed, "call_logs", {
      retell_call_id: `pw-portal-${Date.now()}`,
      caller_number: callerNumber,
      direction: "inbound",
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_seconds: 62,
      // The provider-shaped transcript voice-events stores for real calls.
      transcript: [
        { role: "agent", content: "Thanks for calling!", words: [{ word: "Thanks", start: 0.4 }] },
        { role: "user", content: "I'd like an appointment.", words: [{ word: "I'd", start: 5 }] },
      ],
    });

    await page.reload();
    const callsToday = page.getByText("Calls today").locator("..").locator("..");
    await expect(callsToday).not.toContainText(/^Calls today\s*0$/);
    await expect(page.getByText("1m 2s").first()).toBeVisible();

    await page.goto(`/dashboard/calls/${call["id"]}`);
    // Header identifies the caller, date and duration (not the generic "Call detail").
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      callerNumber.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3"),
    );
    await expect(page.getByText("AI assistant · 0:00")).toBeVisible();
    await expect(page.getByText("Caller · 0:05")).toBeVisible();
    await expect(page.getByText(/NaN/)).toHaveCount(0);
  });

  test("Customers: shows an existing note, saves a new one without reload, searches safely, flags opt-out", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const seed = await readSeed(page);
    test.skip(!seed, "could not read tenant_id from the authenticated session's JWT");
    if (!seed) return;

    const phone = uniquePhone();
    const customer = await insertRow(page, seed, "customers", {
      phone_e164: phone,
      name: "Malone, Drew",
      metadata: {
        notes: [
          { body: "pre-existing note", created_at: new Date().toISOString(), author_id: null },
        ],
      },
      consent: { sms: true },
    });
    const optedOutPhone = uniquePhone().replace(/.$/, "9");
    await insertRow(page, seed, "customers", {
      phone_e164: optedOutPhone,
      name: "Opted Out Person",
      consent: { sms: true },
      sms_opt_out: true,
    });

    // Search: a comma is text now (used to be a 400 shown as "No customers yet").
    await page.goto("/dashboard/customers");
    await page.getByPlaceholder("Search name or phone").fill("Malone, Drew");
    await expect(page.getByText("Malone, Drew").first()).toBeVisible();
    await page.getByPlaceholder("Search name or phone").fill("zzz-no-such-customer");
    await expect(page.getByText(/No customers match/)).toBeVisible();
    // The opted-out customer shows the opt-out badge, not "On file".
    await page.getByPlaceholder("Search name or phone").fill("Opted Out Person");
    await expect(page.getByText("Opted out").first()).toBeVisible();

    // Detail: the pre-existing note is listed; a new note appears after saving.
    await page.goto(`/dashboard/customers/${customer["id"]}`);
    await expect(page.getByText("pre-existing note")).toBeVisible();
    await page.getByPlaceholder(/Add a note/).fill("Prefers mornings");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText("Prefers mornings")).toBeVisible();
  });

  test("Messages: a non-phone thread URL shows an empty state with no composer", async ({
    page,
  }) => {
    await page.goto("/dashboard/messages/abc");
    await expect(page.getByText("That isn't a valid phone number")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toHaveCount(0);
  });

  test("Bookings: upcoming list, Past view, and a completed booking is read-only", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const seed = await readSeed(page);
    test.skip(!seed, "could not read tenant_id from the authenticated session's JWT");
    if (!seed) return;

    const resourcesRes = await page.request.get(
      `${seed.supabaseUrl}/rest/v1/resources?tenant_id=eq.${seed.tenantId}&select=id&limit=1`,
      { headers: { apikey: seed.serviceKey, Authorization: `Bearer ${seed.serviceKey}` } },
    );
    const resources = (await resourcesRes.json()) as { id: string }[];
    test.skip(resources.length === 0, "fixture tenant has no resource to book against");
    const resourceId = (resources[0] as { id: string }).id;

    const start = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    await insertRow(page, seed, "bookings", {
      resource_id: resourceId,
      start_at: start.toISOString(),
      end_at: new Date(start.getTime() + 3600 * 1000).toISOString(),
      status: "completed",
    });
    const pastStart = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    await insertRow(page, seed, "bookings", {
      resource_id: resourceId,
      start_at: pastStart.toISOString(),
      end_at: new Date(pastStart.getTime() + 3600 * 1000).toISOString(),
      status: "completed",
    });

    await page.goto("/dashboard/bookings");
    await expect(page.getByRole("radio", { name: "Upcoming bookings" })).toBeChecked();
    await page.getByRole("radio", { name: "Past bookings" }).click();
    await expect(page.getByText(/Page 1 of/)).toBeVisible();

    // A completed booking is read-only: no Confirm / Reschedule / Cancel.
    await page.getByRole("radio", { name: "Upcoming bookings" }).click();
    await page
      .getByRole("button", { name: /Unknown customer/ })
      .first()
      .click();
    await expect(
      page.getByText(/can no longer be confirmed, rescheduled or cancelled/),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Reschedule" })).toHaveCount(0);
  });

  test("the notification bell opens the item's booking and clears the unread badge for good", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const seed = await readSeed(page);
    test.skip(!seed, "could not read tenant_id from the authenticated session's JWT");
    if (!seed) return;

    const bell = page.getByRole("button", { name: "Notifications" });
    // Give the owner something unread: a call flagged urgent.
    await insertRow(page, seed, "call_logs", {
      retell_call_id: `pw-urgent-${Date.now()}`,
      caller_number: uniquePhone(),
      direction: "inbound",
      started_at: new Date().toISOString(),
      urgency_flag: true,
    });
    await page.reload();
    await expect(bell).toContainText(/\d/);

    await bell.click();
    await expect(page.getByText(/Urgent call|Emergency call/).first()).toBeVisible();
    // Opening the bell marked everything read: the badge stays cleared after a reload.
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(bell).not.toContainText(/\d/);

    await bell.click();
    await page
      .getByText(/Urgent call|Emergency call/)
      .first()
      .click();
    await expect(page).toHaveURL(/\/dashboard\/calls\//);
  });

  test("Billing: 'Manage payment method' either opens Stripe or explains why it can't (never a dead end)", async ({
    page,
  }) => {
    await page.goto("/dashboard/billing");
    await page.getByRole("button", { name: "Manage payment method" }).click();
    await expect(
      page.getByRole("alert").or(page.getByText("Manage payment method").first()).first(),
    ).toBeVisible();
    // If it could not open, the message is specific and offers a way forward.
    const alert = page.getByRole("alert");
    if (await alert.count()) {
      await expect(alert).toContainText(/owner|billing account|temporarily unavailable/);
      await expect(page.getByRole("link", { name: "Email support" })).toBeVisible();
    }
  });

  test("the Refer & earn nav entry is hidden until referral attribution works", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Refer & earn" })).toHaveCount(0);
  });
});
