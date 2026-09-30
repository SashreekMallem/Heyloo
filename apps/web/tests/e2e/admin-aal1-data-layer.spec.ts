import { expect, test } from "@playwright/test";

/**
 * COCKPIT-F01 (QA-2) post-deploy probe. The web proxy refusing a password-only
 * (AAL1) admin is not enough: PostgREST and the `admin` edge function are
 * directly callable with that same token. Two deployed pieces must be live for
 * them to refuse it, and this spec is the check that they are:
 *   - migration 20260930250000 (custom_access_token_hook + fn_jwt_is_platform_admin)
 *   - the `admin` edge function built from this repo (AAL2 gate on every route)
 *
 * Needs the access token of a platform admin signed in with the PASSWORD ONLY
 * (never completed the TOTP challenge), minted AFTER the migration was applied:
 *   E2E_AAL1_ADMIN_ACCESS_TOKEN=<jwt>
 * plus NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. It only
 * issues reads, so it is safe against staging or production. Skips otherwise.
 */
const TOKEN = process.env["E2E_AAL1_ADMIN_ACCESS_TOKEN"];
const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"];
const PUBLISHABLE_KEY = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
test.skip(
  !TOKEN || !SUPABASE_URL || !PUBLISHABLE_KEY,
  "needs E2E_AAL1_ADMIN_ACCESS_TOKEN (a password-only admin token) and the Supabase URL/publishable key",
);

function claimsOf(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

const headers = () => ({ apikey: PUBLISHABLE_KEY as string, authorization: `Bearer ${TOKEN}` });

test("the probe token really is a password-only session without the admin claim", () => {
  const claims = claimsOf(TOKEN as string);
  expect(claims["aal"]).toBe("aal1");
  // The fixed hook stamps an inert marker instead of platform_admin below aal2.
  const appMetadata = (claims["app_metadata"] ?? {}) as Record<string, unknown>;
  expect(appMetadata["platform_admin"]).not.toBe(true);
});

for (const table of ["tenants", "customers", "call_logs", "messages_outbound"]) {
  test(`PostgREST returns no ${table} rows to an AAL1 admin`, async ({ request }) => {
    const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, {
      headers: headers(),
    });
    if (res.ok()) expect(await res.json()).toEqual([]);
    else expect([401, 403]).toContain(res.status());
  });
}

test("the admin edge function refuses an AAL1 admin", async ({ request }) => {
  const res = await request.get(`${SUPABASE_URL}/functions/v1/admin/admin-tenants`, {
    headers: headers(),
  });
  expect(res.status()).toBe(403);
});
