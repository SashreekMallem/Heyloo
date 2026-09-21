import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

let mockUser: unknown = null;
// SIGNUP-1 (docs/BUILD_NOTES.md): claims now come from `auth.getClaims()`
// (the JWT's own, hook-injected claims) — `user.app_metadata` never carries
// them (confirmed live: it reflects `auth.users`' own DB row, which the
// Custom Access Token Hook never writes to). This mock's shape matches
// that fix; see middleware.ts / claims.ts's doc comments for the full story.
let mockClaimsAppMetadata: unknown = {};

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockUser } }),
      getClaims: () =>
        Promise.resolve({
          data: { claims: { app_metadata: mockClaimsAppMetadata } },
          error: null,
        }),
    },
  }),
}));

// next-intl's own middleware (locale negotiation) is a separate, already-
// relied-upon library concern (FRONTEND_AUDIT M4 is about static rendering,
// not this); mocked to a pass-through here so this suite stays focused on
// THIS file's own guard #1 redirect matrix, and to avoid a pnpm-hoisting
// ESM-resolution quirk resolving "next/server" from next-intl's own nested
// `node_modules/next` under vitest.
vi.mock("next-intl/middleware", async () => {
  const { NextResponse } = await import("next/server");
  return {
    default:
      () =>
      (request: NextRequest): unknown =>
        NextResponse.next({ request }),
  };
});

const { middleware } = await import("./middleware");

function req(path: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

describe("middleware — guard #1 redirect matrix (FRONTEND_SPEC.md §0.1)", () => {
  it("redirects an unauthenticated caller away from /dashboard to /login with next=", async () => {
    mockUser = null;
    mockClaimsAppMetadata = {};
    const res = await middleware(req("/dashboard"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/dashboard");
  });

  it("redirects a caller with no tenant_id claim away from /dashboard", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsAppMetadata = { platform_admin: true };
    const res = await middleware(req("/dashboard/calls"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("toast")).toBe("no_access");
  });

  it("passes a tenant member through to /dashboard", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsAppMetadata = { tenant_id: "t1", role: "owner" };
    const res = await middleware(req("/dashboard/calls"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("SIGNUP-1 regression: ignores a stale tenant_id in user.app_metadata that isn't in the JWT's own claims", async () => {
    mockUser = { id: "u1", app_metadata: { tenant_id: "stale-tenant", role: "owner" } };
    mockClaimsAppMetadata = {};
    const res = await middleware(req("/dashboard/calls"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("toast")).toBe("no_access");
  });

  it("redirects an unauthenticated caller away from /cockpit to /login", async () => {
    mockUser = null;
    mockClaimsAppMetadata = {};
    const res = await middleware(req("/cockpit/tenants"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/cockpit/tenants");
  });

  it("redirects a caller with no platform_admin claim away from /cockpit", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsAppMetadata = { tenant_id: "t1", role: "owner" };
    const res = await middleware(req("/cockpit"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("toast")).toBe("no_access");
  });

  it("passes a platform_admin through to /cockpit (AAL2 step-up is the layout's job, per §0.2)", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsAppMetadata = { platform_admin: true };
    const res = await middleware(req("/cockpit"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects a caller with no referral_partner_id claim away from /portal", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsAppMetadata = { tenant_id: "t1", role: "owner" };
    const res = await middleware(req("/portal/payouts"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("toast")).toBe("no_access");
  });

  it("passes a referral partner through to /portal", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsAppMetadata = { referral_partner_id: "p1" };
    const res = await middleware(req("/portal"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("leaves public auth routes (/login, /mfa/*, /reset-password) unguarded regardless of session", async () => {
    mockUser = null;
    mockClaimsAppMetadata = {};
    for (const path of ["/login", "/mfa/enroll", "/reset-password"]) {
      const res = await middleware(req(path));
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("leaves marketing routes unguarded regardless of session", async () => {
    mockUser = null;
    mockClaimsAppMetadata = {};
    const res = await middleware(req("/pricing"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("stamps x-pathname on the response so route groups can tell their own path apart from siblings", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsAppMetadata = { referral_partner_id: "p1" };
    const res = await middleware(req("/portal/disclosure"));
    expect(res.headers.get("x-pathname")).toBe("/portal/disclosure");
  });

  it("never runs the intl middleware against /api routes (would otherwise rewrite and 404 them, BUILD_NOTES.md T5)", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsAppMetadata = { tenant_id: "t1", role: "owner" };
    const res = await middleware(req("/api/tenant/bookings/b1"));
    expect(res.headers.get("location")).toBeNull();
  });
});
