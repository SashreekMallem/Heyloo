import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

let mockUser: unknown = null;
// SIGNUP-1 (docs/BUILD_NOTES.md): claims now come from `auth.getClaims()`
// (the JWT's own, hook-injected claims) — `user.app_metadata` never carries
// them (confirmed live: it reflects `auth.users`' own DB row, which the
// Custom Access Token Hook never writes to). This mock's shape matches
// that fix; see middleware.ts / claims.ts's doc comments for the full story.
let mockClaimsAppMetadata: unknown = {};
let mockAal: string | undefined;
let mockNextLevel: string = "aal1";

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockUser } }),
      getClaims: () =>
        Promise.resolve({
          data: { claims: { aal: mockAal, app_metadata: mockClaimsAppMetadata } },
          error: null,
        }),
      mfa: {
        getAuthenticatorAssuranceLevel: () =>
          Promise.resolve({ data: { currentLevel: mockAal ?? "aal1", nextLevel: mockNextLevel } }),
      },
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
    expect(location.pathname).toBe("/no-access");
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
    expect(location.pathname).toBe("/no-access");
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
    expect(location.pathname).toBe("/no-access");
  });

  it("passes an aal2 platform_admin through to /cockpit", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsAppMetadata = { platform_admin: true };
    mockAal = "aal2";
    const res = await middleware(req("/cockpit"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects a caller with no referral_partner_id claim away from /portal", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsAppMetadata = { tenant_id: "t1", role: "owner" };
    const res = await middleware(req("/portal/payouts"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/no-access");
  });

  it("passes a referral partner through to /portal", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsAppMetadata = { referral_partner_id: "p1" };
    const res = await middleware(req("/portal"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("AUTH-11/COCKPIT-F19: steps an aal1 admin with a verified factor up at the challenge, preserving the requested path and query", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsAppMetadata = { admin_mfa_required: true };
    mockAal = "aal1";
    mockNextLevel = "aal2";
    const res = await middleware(req("/cockpit/tenants?status=active"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/mfa/challenge");
    expect(location.searchParams.get("next")).toBe("/cockpit/tenants?status=active");
  });

  it("SEC-01: sends an aal1 admin with no verified factor to enrollment (never to no-access)", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsAppMetadata = { admin_mfa_required: true };
    mockAal = "aal1";
    mockNextLevel = "aal1";
    const res = await middleware(req("/cockpit"));
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/mfa/enroll");
  });

  it("AUTH-12: keeps the full deep link (path + query) in next and drops stray params", async () => {
    mockUser = null;
    mockClaimsAppMetadata = {};
    mockAal = undefined;
    const res = await middleware(req("/dashboard/billing?x=1"));
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect([...location.searchParams.keys()]).toEqual(["next"]);
    expect(location.searchParams.get("next")).toBe("/dashboard/billing?x=1");
    expect(location.search).toBe("?next=%2Fdashboard%2Fbilling%3Fx%3D1");
  });

  it("AUTH-09: bounces a signed-in visitor off /login to their role home", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    const cases: [Record<string, unknown>, string][] = [
      [{ tenant_id: "t1", role: "owner" }, "/dashboard"],
      [{ referral_partner_id: "p1" }, "/portal"],
      [{ platform_admin: true }, "/cockpit"],
      [{ admin_mfa_required: true }, "/cockpit"],
      [{}, "/no-access"],
    ];
    for (const [claims, home] of cases) {
      mockClaimsAppMetadata = claims;
      const res = await middleware(req("/login"));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location") ?? "").pathname).toBe(home);
    }
  });

  it("AUTH-09: a signed-in visitor on /login goes to a safe next, but never to an external one", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsAppMetadata = { tenant_id: "t1", role: "owner" };
    const ok = await middleware(req("/login?next=%2Fdashboard%2Fcalls"));
    expect(new URL(ok.headers.get("location") ?? "").pathname).toBe("/dashboard/calls");
    const evil = await middleware(req("/login?next=https%3A%2F%2Fexample.org%2Fphish"));
    expect(new URL(evil.headers.get("location") ?? "").origin).toBe("http://localhost:3000");
    expect(new URL(evil.headers.get("location") ?? "").pathname).toBe("/dashboard");
  });

  it("AUTH-04: a signed-in visitor still sees /login when it carries a failed-email-link notice", async () => {
    mockUser = { id: "u1", app_metadata: {} };
    mockClaimsAppMetadata = { tenant_id: "t1", role: "owner" };
    const res = await middleware(req("/login?toast=confirm_failed"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("leaves public auth routes (/login, /mfa/*, /reset-password) unguarded for an anonymous visitor", async () => {
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

  it("leaves /auth/confirm unguarded and un-rewritten (QA-PORTAL: it lives outside [locale], same T5 hazard as /api)", async () => {
    mockUser = null;
    mockClaimsAppMetadata = {};
    const res = await middleware(req("/auth/confirm?token_hash=abc&type=invite"));
    expect(res.headers.get("location")).toBeNull();
  });
});
