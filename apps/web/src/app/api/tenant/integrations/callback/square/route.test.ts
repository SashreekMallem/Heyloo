import { describe, expect, it, vi } from "vitest";

let mockSession: { user: { app_metadata: Record<string, unknown> }; access_token: string } | null =
  null;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: mockSession } }),
      // AUTH-1 (docs/BUILD_NOTES.md): claims now come from `auth.getClaims()`,
      // not `session.user.app_metadata` — bridge it off the SAME mocked
      // session so every existing `mockSession` scenario above still
      // drives the route's authorization outcome unchanged.
      getClaims: () =>
        Promise.resolve({
          data: { claims: { app_metadata: mockSession?.user.app_metadata ?? {} } },
          error: null,
        }),
    },
  }),
}));

let mockCallEdgeFunction = vi.fn();
vi.mock("@/lib/edge-functions", () => ({
  callEdgeFunction: (...args: unknown[]) => mockCallEdgeFunction(...args),
}));

const { GET } = await import("./route");

function ownerSession() {
  return { user: { app_metadata: { tenant_id: "t1", role: "owner" } }, access_token: "at1" };
}

async function bodyText(res: Response): Promise<string> {
  return res.text();
}

describe("GET /api/tenant/integrations/callback/square", () => {
  it("returns a failure popup page when Square itself reports an oauth error", async () => {
    const res = await GET(new Request("http://localhost/callback/square?error=access_denied"));
    expect(res.status).toBe(400);
    expect(await bodyText(res)).toContain("square_oauth_error:access_denied");
  });

  it("returns a failure popup page when code/state are missing", async () => {
    const res = await GET(new Request("http://localhost/callback/square"));
    expect(res.status).toBe(400);
    expect(await bodyText(res)).toContain("missing_code_or_state");
  });

  it("returns unauthenticated when there is no session", async () => {
    mockSession = null;
    const res = await GET(new Request("http://localhost/callback/square?code=c1&state=s1"));
    expect(res.status).toBe(401);
    expect(await bodyText(res)).toContain("unauthenticated");
  });

  it("proxies to api-adapter-connect's callback action and reports success", async () => {
    mockSession = ownerSession();
    mockCallEdgeFunction = vi.fn(async () => ({ status: 200, body: { connected: true } }));
    const res = await GET(new Request("http://localhost/callback/square?code=c1&state=s1"));
    expect(res.status).toBe(200);
    expect(await bodyText(res)).toContain('"ok":true');
    expect(mockCallEdgeFunction).toHaveBeenCalledWith(
      "api-adapter-connect",
      expect.objectContaining({
        accessToken: "at1",
        body: { action: "callback", provider: "square", code: "c1", state: "s1" },
      }),
    );
  });

  it("surfaces the edge function's own failure (e.g. state mismatch) honestly", async () => {
    mockSession = ownerSession();
    mockCallEdgeFunction = vi.fn(async () => ({
      status: 401,
      body: { error: "state_tenant_mismatch" },
    }));
    const res = await GET(new Request("http://localhost/callback/square?code=c1&state=s1"));
    expect(res.status).toBe(401);
    expect(await bodyText(res)).toContain("state_tenant_mismatch");
  });
});
