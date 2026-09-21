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
      // AUTH-1 (docs/BUILD_NOTES.md): mirrors `test-agent/web-call/
      // route.test.ts`'s own bridge — claims come from `auth.getClaims()`,
      // not `session.user.app_metadata` directly.
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

describe("POST /api/tenant/agent/publish (PUBLISH-1)", () => {
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

  it("sends no body, only the owner's bearer token, to the edge function", async () => {
    mockSession = { user: mockUser, access_token: "tok-abc" };
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(
          JSON.stringify({
            tenant_id: "t1",
            agent_id: "agent_new",
            published_at: "2026-09-21T00:00:00Z",
          }),
          { status: 200 },
        );
      }),
    );
    const res = await POST();
    expect(res.status).toBe(200);
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.body).toBeUndefined();
    expect((capturedInit?.headers as Record<string, string>)?.["authorization"]).toBe(
      "Bearer tok-abc",
    );
    vi.unstubAllGlobals();
  });

  it("passes the edge function's own role-check 403 straight through for a non-owner/admin member (never fabricates success)", async () => {
    mockSession = {
      user: { id: "u1", app_metadata: { tenant_id: "t1", role: "member" } },
      access_token: "tok",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })),
    );
    const res = await POST();
    expect(res.status).toBe(403);
    vi.unstubAllGlobals();
  });

  it("degrades honestly (passes through the backend's error status) rather than fabricating success", async () => {
    mockSession = { user: mockUser, access_token: "tok" };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "retell_flow_create_failed" }), { status: 502 }),
      ),
    );
    const res = await POST();
    expect(res.status).toBe(502);
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
