import { describe, expect, it, vi } from "vitest";

const mockUser = { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } };
let mockSession: { user: unknown; access_token: string } | null = {
  user: mockUser,
  access_token: "tok",
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: mockSession } }),
      // AUTH-1 (docs/BUILD_NOTES.md): the route now reads claims via
      // `auth.getClaims()`, not `session.user.app_metadata` — bridge it
      // off the SAME mocked session so every existing `mockSession`
      // scenario above still drives the route's authorization outcome.
      getClaims: async () => ({
        data: {
          claims: {
            app_metadata: mockSession?.user
              ? ((mockSession.user as { app_metadata?: unknown }).app_metadata ?? {})
              : {},
          },
        },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/lib/env", () => ({
  env: { supabaseFunctionsUrl: "https://project.supabase.co/functions/v1" },
}));

const { POST } = await import("./route");

describe("POST /api/tenant/test-agent/web-call", () => {
  it("401s when unauthenticated, without calling fetch", async () => {
    mockSession = null;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("403s without a tenant_id claim", async () => {
    mockSession = { user: { id: "u1", app_metadata: {} }, access_token: "tok" };
    const res = await POST();
    expect(res.status).toBe(403);
  });

  it("degrades honestly (passes through the backend's not-implemented status) rather than fabricating success", async () => {
    mockSession = { user: mockUser, access_token: "tok" };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: "not_implemented" }), { status: 501 }),
      ),
    );
    const res = await POST();
    expect(res.status).toBe(501);
    vi.unstubAllGlobals();
  });

  it("503s when the edge function is unreachable", async () => {
    mockSession = { user: mockUser, access_token: "tok" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );
    const res = await POST();
    expect(res.status).toBe(503);
    vi.unstubAllGlobals();
  });
});
