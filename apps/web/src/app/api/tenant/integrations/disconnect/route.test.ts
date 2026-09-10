import { describe, expect, it, vi } from "vitest";

let mockSession: { user: { app_metadata: Record<string, unknown> }; access_token: string } | null =
  null;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: mockSession } }) },
  }),
}));

let mockCallEdgeFunction = vi.fn();
vi.mock("@/lib/edge-functions", () => ({
  callEdgeFunction: (...args: unknown[]) => mockCallEdgeFunction(...args),
}));

const { POST } = await import("./route");

function req(body: unknown) {
  return new Request("http://localhost/api/tenant/integrations/disconnect", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function ownerSession(overrides: Record<string, unknown> = {}) {
  return {
    user: { app_metadata: { tenant_id: "t1", role: "owner", ...overrides } },
    access_token: "at1",
  };
}

describe("POST /api/tenant/integrations/disconnect", () => {
  it("401s when unauthenticated", async () => {
    mockSession = null;
    const res = await POST(req({ provider: "square" }));
    expect(res.status).toBe(401);
  });

  it("403s for a member", async () => {
    mockSession = ownerSession({ role: "member" });
    const res = await POST(req({ provider: "square" }));
    expect(res.status).toBe(403);
  });

  it("400s for an unknown provider", async () => {
    mockSession = ownerSession();
    const res = await POST(req({ provider: "shopify" }));
    expect(res.status).toBe(400);
  });

  it("proxies a valid disconnect and returns the edge function's result", async () => {
    mockSession = ownerSession();
    mockCallEdgeFunction = vi.fn(async () => ({
      status: 200,
      body: { disconnected: true, provider: "square" },
    }));
    const res = await POST(req({ provider: "square" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disconnected: true, provider: "square" });
    expect(mockCallEdgeFunction).toHaveBeenCalledWith(
      "api-adapter-connect",
      expect.objectContaining({
        method: "POST",
        accessToken: "at1",
        body: { action: "disconnect", provider: "square" },
      }),
    );
  });
});
