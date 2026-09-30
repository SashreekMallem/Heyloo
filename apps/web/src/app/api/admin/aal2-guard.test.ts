import { describe, expect, it, vi } from "vitest";

// COCKPIT-F01: every Next-side admin route that talks to Postgres directly
// (service role) must refuse a password-only (AAL1) admin session for reads
// AND writes, before touching the database. The edge-function proxy has its own
// test next to `[...path]/route.ts`.

let mockAal: string | undefined = "aal1";
const serviceRoleClient = vi.fn(() => {
  throw new Error("service-role client must not be created for an AAL1 session");
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "admin1" }, access_token: "t" } },
      }),
      getClaims: async () => ({
        data: { claims: { app_metadata: { platform_admin: true }, aal: mockAal } },
        error: null,
      }),
    },
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createSupabaseServiceRoleServerClient: () => serviceRoleClient(),
}));

const ID = { id: "3f2a9c1e-0000-4000-8000-000000000001" };
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
const req = (method: string) =>
  new Request("http://localhost/api/admin/x", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" || method === "DELETE" ? undefined : "{}",
  });

const fees = await import("./admin-platform-settings/fees/route");
const partners = await import("./admin-referral-partners/route");
const partner = await import("./admin-referral-partners/[id]/route");
const override = await import("./admin-referral-partners/[id]/overrides/[vertical]/route");
const supportList = await import("./admin-support-requests/route");
const support = await import("./admin-support-requests/[id]/route");
const notes = await import("./admin-support-requests/[id]/notes/route");

const calls: [string, () => Promise<Response>][] = [
  ["GET fees", () => fees.GET()],
  ["POST fees", () => fees.POST(req("POST"))],
  ["GET referral partners", () => partners.GET()],
  ["GET referral partner", () => partner.GET(req("GET"), params(ID))],
  ["PATCH referral partner", () => partner.PATCH(req("PATCH"), params(ID))],
  [
    "PUT partner override",
    () => override.PUT(req("PUT"), params({ ...ID, vertical: "auto" })),
  ],
  [
    "DELETE partner override",
    () => override.DELETE(req("DELETE"), params({ ...ID, vertical: "auto" })),
  ],
  ["GET support requests", () => supportList.GET(req("GET"))],
  ["GET support request", () => support.GET(req("GET"), params(ID))],
  ["PATCH support request", () => support.PATCH(req("PATCH"), params(ID))],
  ["POST support note", () => notes.POST(req("POST"), params(ID))],
];

describe("Next-side admin routes require AAL2 (COCKPIT-F01)", () => {
  it.each(calls)("%s -> 403 aal2_required at AAL1", async (_name, call) => {
    mockAal = "aal1";
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "aal2_required" });
    expect(serviceRoleClient).not.toHaveBeenCalled();
  });

  it.each(calls)("%s -> 403 when the JWT has no aal claim", async (_name, call) => {
    mockAal = undefined;
    const res = await call();
    expect(res.status).toBe(403);
    expect(serviceRoleClient).not.toHaveBeenCalled();
  });
});
