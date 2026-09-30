import { describe, expect, it, vi } from "vitest";

// COCKPIT-F03: an unexpected throw inside a direct-Postgres admin handler (for
// example a missing SUPABASE_SECRET_KEY) must come back as JSON, not as Next's
// empty-body 500.

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "admin1" }, access_token: "t" } },
      }),
      getClaims: async () => ({
        data: { claims: { app_metadata: { platform_admin: true }, aal: "aal2" } },
        error: null,
      }),
    },
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createSupabaseServiceRoleServerClient: () => {
    throw new Error("SUPABASE_SECRET_KEY is not set");
  },
}));

const partners = await import("./admin-referral-partners/route");
const support = await import("./admin-support-requests/route");
const fees = await import("./admin-platform-settings/fees/route");

describe("direct-Postgres admin routes answer unexpected failures with JSON", () => {
  it.each([
    ["referral partners", () => partners.GET()],
    ["support requests", () => support.GET(new Request("http://localhost/api/admin/x"))],
    ["fees", () => fees.GET()],
  ])("%s -> 500 {error}", async (_name, call) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    spy.mockRestore();
  });
});
