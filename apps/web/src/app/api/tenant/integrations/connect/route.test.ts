import { describe, expect, it, vi } from "vitest";

let mockSession: { user: { app_metadata: Record<string, unknown> }; access_token: string } | null =
  null;
// AUTH-1 (docs/BUILD_NOTES.md): claims come from `auth.getClaims()` — the
// JWT's own hook-injected claims — not `session.user.app_metadata`. Kept
// separate from `mockSession` to prove the JWT-only claim is what's
// actually honored.
let mockClaimsAppMetadata: Record<string, unknown> = {};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: mockSession } }),
      getClaims: () =>
        Promise.resolve({ data: { claims: { app_metadata: mockClaimsAppMetadata } }, error: null }),
    },
  }),
}));

let mockCallEdgeFunction = vi.fn();
vi.mock("@/lib/edge-functions", () => ({
  callEdgeFunction: (...args: unknown[]) => mockCallEdgeFunction(...args),
}));

const { POST } = await import("./route");

function req(body: unknown) {
  return new Request("http://localhost/api/tenant/integrations/connect", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function ownerSession(overrides: Record<string, unknown> = {}) {
  const appMetadata = { tenant_id: "t1", role: "owner", ...overrides };
  mockClaimsAppMetadata = appMetadata;
  return {
    user: { app_metadata: {} },
    access_token: "at1",
  };
}

describe("POST /api/tenant/integrations/connect", () => {
  it("401s when unauthenticated", async () => {
    mockSession = null;
    const res = await POST(req({ provider: "square" }));
    expect(res.status).toBe(401);
  });

  it("403s for a member (not owner/admin)", async () => {
    mockSession = ownerSession({ role: "member" });
    const res = await POST(req({ provider: "square" }));
    expect(res.status).toBe(403);
  });

  it("400s when provider is missing", async () => {
    mockSession = ownerSession();
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("400s for an unrecognized provider", async () => {
    mockSession = ownerSession();
    const res = await POST(req({ provider: "shopify" }));
    expect(res.status).toBe(400);
  });

  it("proxies an OAuth provider as action:initiate and returns the authorize_url", async () => {
    mockSession = ownerSession();
    mockCallEdgeFunction = vi.fn(async () => ({
      status: 200,
      body: { authorize_url: "https://connect.squareup.com/oauth2/authorize?state=x" },
    }));
    const res = await POST(req({ provider: "square" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authorize_url: "https://connect.squareup.com/oauth2/authorize?state=x",
    });
    expect(mockCallEdgeFunction).toHaveBeenCalledWith(
      "api-adapter-connect",
      expect.objectContaining({
        method: "POST",
        accessToken: "at1",
        body: { action: "initiate", provider: "square" },
      }),
    );
  });

  it("400s a shopmonkey paste-key request missing api_key", async () => {
    mockSession = ownerSession();
    const res = await POST(req({ provider: "shopmonkey" }));
    expect(res.status).toBe(400);
  });

  it("proxies a shopmonkey paste-key connect with the api_key", async () => {
    mockSession = ownerSession();
    mockCallEdgeFunction = vi.fn(async () => ({
      status: 200,
      body: { connected: true, provider: "shopmonkey" },
    }));
    const res = await POST(req({ provider: "shopmonkey", api_key: "sk_live_123" }));
    expect(res.status).toBe(200);
    expect(mockCallEdgeFunction).toHaveBeenCalledWith(
      "api-adapter-connect",
      expect.objectContaining({
        body: { action: "paste_key", provider: "shopmonkey", api_key: "sk_live_123" },
      }),
    );
  });

  it("400s an ezyvet paste-key request missing base_url", async () => {
    mockSession = ownerSession();
    const res = await POST(req({ provider: "ezyvet" }));
    expect(res.status).toBe(400);
  });

  it("passes through the edge function's error status/body on failure", async () => {
    mockSession = ownerSession();
    mockCallEdgeFunction = vi.fn(async () => ({
      status: 401,
      body: { error: "shopmonkey_api_key_invalid" },
    }));
    const res = await POST(req({ provider: "shopmonkey", api_key: "bad" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "shopmonkey_api_key_invalid" });
  });
});
