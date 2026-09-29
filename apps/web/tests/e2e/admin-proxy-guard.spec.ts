import { expect, test } from "@playwright/test";

/**
 * SEC-12: `/api/admin/[...path]` forwards the admin's bearer token to
 * `<functions>/admin/<path>`. An encoded `../` used to walk out of `/admin/` into
 * a sibling edge function. The path check runs before the session is read, so it
 * is observable without any login or backend (pure HTTP against the built app).
 */
test.describe("admin proxy path guard", () => {
  for (const path of [
    "..%2fforwarding-verify",
    "admin-tenants/..%2f..%2fforwarding-verify",
    "..%2fapi-demo-agent",
  ]) {
    test(`refuses the traversal ${path} with 400`, async ({ request }) => {
      const res = await request.get(`/api/admin/${path}`);
      expect(res.status()).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_path" });
    });
  }

  test("a normal admin route without a session is 401, not 400", async ({ request }) => {
    const res = await request.get("/api/admin/admin-tenants");
    expect(res.status()).toBe(401);
  });

  test("DELETE reaches the guard (401 without a session), not a 405", async ({ request }) => {
    const res = await request.delete(
      "/api/admin/admin-alerts/rules/00000000-0000-4000-8000-000000000001",
    );
    expect(res.status()).toBe(401);
  });
});
