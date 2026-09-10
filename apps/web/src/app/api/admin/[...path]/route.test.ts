import { describe, expect, it, vi } from "vitest";

const mockUser = { id: "admin1", app_metadata: { platform_admin: true } };

let mockSession: { user: unknown; access_token: string } | null = {
  user: mockUser,
  access_token: "token-123",
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: mockSession } }),
    },
  }),
}));

vi.mock("@/lib/env", () => ({
  env: {
    supabaseFunctionsUrl: "https://project.supabase.co/functions/v1",
  },
}));

const { GET } = await import("./route");

function getRequest(pathSuffix: string) {
  return new Request(`http://localhost/api/admin/${pathSuffix}`, { method: "GET" });
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
});
