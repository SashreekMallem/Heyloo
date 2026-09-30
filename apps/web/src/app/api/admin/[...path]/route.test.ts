import { describe, expect, it, vi } from "vitest";

const mockUser = { id: "admin1", app_metadata: { platform_admin: true }, aal: "aal2" };

let mockSession: { user: unknown; access_token: string } | null = {
  user: mockUser,
  access_token: "token-123",
};
// AUTH-1 (docs/BUILD_NOTES.md): set only by the dedicated regression test
// below to decouple `getClaims()`'s answer from `getSession()`'s, proving
// the route honors the JWT-only claim rather than `session.user.app_metadata`.
let mockClaimsOverride: Record<string, unknown> | undefined;
// SEC-01: the JWT `aal` claim the mocked getClaims() reports.
let mockAal: "aal1" | "aal2" = "aal2";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: mockSession } }),
      // AUTH-1 (docs/BUILD_NOTES.md): the route now reads claims (both
      // `platform_admin` and `impersonated_by`) via `auth.getClaims()`,
      // not `session.user.app_metadata` — bridge it off the SAME mocked
      // session by default, unless decoupled via `mockClaimsOverride`.
      getClaims: async () => {
        const s = mockSession?.user as { app_metadata?: unknown; aal?: string } | undefined;
        return {
          data: {
            claims: {
              app_metadata: mockClaimsOverride ?? s?.app_metadata ?? {},
              aal: mockAal === "aal1" ? mockAal : s?.aal,
            },
          },
          error: null,
        };
      },
    },
  }),
}));

vi.mock("@/lib/env", () => ({
  env: {
    supabaseFunctionsUrl: "https://project.supabase.co/functions/v1",
  },
}));

const { DELETE, GET, PATCH, POST } = await import("./route");

function getRequest(pathSuffix: string) {
  return new Request(`http://localhost/api/admin/${pathSuffix}`, { method: "GET" });
}

function postRequest(pathSuffix: string, body: unknown = {}) {
  return new Request(`http://localhost/api/admin/${pathSuffix}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/[...path]", () => {
  it("proxies to the deployed `admin` function with the admin/ prefix retained", async () => {
    mockSession = { user: mockUser, access_token: "token-123" };
    let capturedUrl: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    const res = await GET(getRequest("admin-cockpit/waterfall"), {
      params: Promise.resolve({ path: ["admin-cockpit", "waterfall"] }),
    });

    expect(capturedUrl).toBe(
      "https://project.supabase.co/functions/v1/admin/admin-cockpit/waterfall",
    );
    expect(res.status).toBe(200);

    vi.unstubAllGlobals();
  });

  it("401s when unauthenticated, without calling fetch", async () => {
    mockSession = null;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await GET(getRequest("admin-tenants"), {
      params: Promise.resolve({ path: ["admin-tenants"] }),
    });

    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("SEC-01: 403s aal2_required for a platform_admin token at aal1, without calling fetch", async () => {
    mockSession = { user: mockUser, access_token: "token-aal1" };
    mockAal = "aal1";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await GET(getRequest("admin-tenants"), {
      params: Promise.resolve({ path: ["admin-tenants"] }),
    });

    mockAal = "aal2";
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "aal2_required" });
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("403s when the caller lacks platform_admin, without calling fetch", async () => {
    mockSession = { user: { id: "u2", app_metadata: {} }, access_token: "token-456" };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await GET(getRequest("admin-tenants"), {
      params: Promise.resolve({ path: ["admin-tenants"] }),
    });

    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("forwards impersonate-end for a session carrying impersonated_by but no platform_admin claim", async () => {
    mockSession = {
      user: {
        id: "owner-1",
        app_metadata: { tenant_id: "t1", role: "owner", impersonated_by: "admin_1" },
      },
      access_token: "owner-token",
    };
    let capturedUrl: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ ended: true }), { status: 200 });
      }),
    );

    const res = await POST(postRequest("admin-tenants/t1/impersonate-end"), {
      params: Promise.resolve({ path: ["admin-tenants", "t1", "impersonate-end"] }),
    });

    expect(capturedUrl).toBe(
      "https://project.supabase.co/functions/v1/admin/admin-tenants/t1/impersonate-end",
    );
    expect(res.status).toBe(200);

    vi.unstubAllGlobals();
  });

  it("still 403s a non-self-service admin route for a session carrying impersonated_by but no platform_admin claim", async () => {
    mockSession = {
      user: {
        id: "owner-1",
        app_metadata: { tenant_id: "t1", role: "owner", impersonated_by: "admin_1" },
      },
      access_token: "owner-token",
    };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await GET(getRequest("admin-tenants"), {
      params: Promise.resolve({ path: ["admin-tenants"] }),
    });

    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("AUTH-1 regression: honors a platform_admin claim present ONLY in the JWT (auth.getClaims()), absent from session.user.app_metadata", async () => {
    mockSession = {
      user: { id: "admin1", app_metadata: {}, aal: "aal2" },
      access_token: "token-123",
    };
    mockClaimsOverride = { platform_admin: true };
    let capturedUrl: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    const res = await GET(getRequest("admin-tenants"), {
      params: Promise.resolve({ path: ["admin-tenants"] }),
    });

    expect(capturedUrl).toBe("https://project.supabase.co/functions/v1/admin/admin-tenants");
    expect(res.status).toBe(200);

    mockClaimsOverride = undefined;
    vi.unstubAllGlobals();
  });

  it("AUTH-1 regression: 403s when the JWT's own claims carry no platform_admin, even if session.user.app_metadata (stale) has it", async () => {
    mockSession = {
      user: { id: "admin1", app_metadata: { platform_admin: true } },
      access_token: "token-123",
    };
    mockClaimsOverride = {};
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await GET(getRequest("admin-tenants"), {
      params: Promise.resolve({ path: ["admin-tenants"] }),
    });

    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();

    mockClaimsOverride = undefined;
    vi.unstubAllGlobals();
  });
});

// COCKPIT-F01: the page guard enforces MFA, but the API is directly callable.
describe("AAL2 enforcement (COCKPIT-F01)", () => {
  const aal1Admin = () => ({
    user: { id: "admin1", app_metadata: { platform_admin: true }, aal: "aal1" },
    access_token: "aal1-token",
  });
  const cases: [string, string[]][] = [
    ["GET", ["admin-tenants"]],
    ["GET", ["admin-cockpit", "waterfall"]],
    ["GET", ["admin-platform-settings"]],
    ["GET", ["admin-alerts"]],
    ["PATCH", ["admin-tenants", "3f2a9c1e-0000-4000-8000-000000000001"]],
    ["POST", ["admin-templates", "auto", "publish"]],
    ["DELETE", ["admin-alerts", "rules", "3f2a9c1e-0000-4000-8000-000000000001"]],
  ];
  const handlers = { GET, POST, PATCH, DELETE } as const;

  it.each(cases)(
    "%s %j 403s aal2_required for a password-only admin, nothing forwarded",
    async (method, path) => {
      mockSession = aal1Admin();
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const res = await handlers[method as keyof typeof handlers](
        new Request("http://localhost/api/admin/x", { method }),
        { params: Promise.resolve({ path }) },
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "aal2_required" });
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    },
  );

  it("403s when the JWT carries no aal claim at all (fail closed)", async () => {
    mockSession = {
      user: { id: "admin1", app_metadata: { platform_admin: true } },
      access_token: "t",
    };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await GET(getRequest("admin-tenants"), {
      params: Promise.resolve({ path: ["admin-tenants"] }),
    });
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// SEC-12: a decoded `../` segment must never leave `/admin/`.
describe("path-segment validation (SEC-12)", () => {
  const unsafe: string[][] = [
    ["../forwarding-verify"],
    ["admin-tenants", "../../forwarding-verify"],
    ["..", "api-demo-agent"],
    [".."],
    ["."],
    ["admin-tenants", "a\\b"],
    ["admin-tenants", "x\u0000y"],
    ["admin-tenants", "x y"],
    ["admin-tenants", ""],
    [],
  ];
  it.each(unsafe)("400s %j without forwarding the admin's token", async (...path) => {
    mockSession = { user: mockUser, access_token: "token-123" };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await GET(getRequest("x"), { params: Promise.resolve({ path }) });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("still forwards ordinary ids and slugs", async () => {
    mockSession = { user: mockUser, access_token: "token-123" };
    let capturedUrl: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return new Response("{}", { status: 200 });
      }),
    );
    await GET(getRequest("x"), {
      params: Promise.resolve({
        path: ["admin-templates", "real_estate", "3f2a9c1e-0000-4000-8000-000000000001"],
      }),
    });
    expect(capturedUrl).toBe(
      "https://project.supabase.co/functions/v1/admin/admin-templates/real_estate/3f2a9c1e-0000-4000-8000-000000000001",
    );
    vi.unstubAllGlobals();
  });
});

// COCKPIT-F24: the edge function's `DELETE rules/:id` was unreachable (the proxy 405'd it).
describe("DELETE /api/admin/[...path]", () => {
  it("forwards DELETE with the admin bearer token", async () => {
    mockSession = { user: mockUser, access_token: "token-123" };
    let captured: { url: string; init: RequestInit | undefined } | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        captured = { url, init };
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      }),
    );
    const res = await DELETE(new Request("http://localhost/api/admin/x", { method: "DELETE" }), {
      params: Promise.resolve({ path: ["admin-alerts", "rules", "r1"] }),
    });
    expect(res.status).toBe(200);
    expect(captured?.url).toBe(
      "https://project.supabase.co/functions/v1/admin/admin-alerts/rules/r1",
    );
    expect(captured?.init?.method).toBe("DELETE");
    expect(captured?.init?.body).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("403s a non-admin DELETE", async () => {
    mockSession = { user: { id: "u2", app_metadata: {} }, access_token: "t" };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await DELETE(new Request("http://localhost/api/admin/x", { method: "DELETE" }), {
      params: Promise.resolve({ path: ["admin-alerts", "rules", "r1"] }),
    });
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
