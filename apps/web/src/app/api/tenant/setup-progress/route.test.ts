import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "maybeSingle"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

function makeFrom(queue: Record<string, unknown[]>) {
  return vi.fn((table: string) => {
    const q = queue[table];
    const result = q?.length ? q.shift() : { data: null, count: 0, error: null };
    return chain(result);
  });
}

const mockUser = { id: "u1", app_metadata: {} };
let mockGetUser: () => Promise<{ data: { user: unknown } }> = async () => ({
  data: { user: mockUser },
});
// SIGNUP-1: claims now come from `auth.getClaims()`, not `user.app_metadata`.
let mockClaimsAppMetadata: unknown = { tenant_id: "t1", role: "owner" };
let serverQueue: Record<string, unknown[]> = {};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getUser: () => mockGetUser(),
      getClaims: () =>
        Promise.resolve({
          data: { claims: { app_metadata: mockClaimsAppMetadata } },
          error: null,
        }),
    },
    from: makeFrom(serverQueue),
  }),
}));

const { GET } = await import("./route");

function fullyDoneQueue(): Record<string, unknown[]> {
  return {
    tenants: [
      {
        data: {
          status: "active",
          a2p_status: "verified",
          business_hours: { mon: [{ open: "08:00", close: "18:00" }] },
          policies_reviewed_at: "2026-01-01T00:00:00.000Z",
        },
        error: null,
      },
    ],
    agent_configs: [
      {
        data: {
          published_at: "2026-01-01",
          dynamic_variable_overrides: {
            cancellation_policy: { text: "24h notice" },
            delivery: { sms_enabled: true },
          },
        },
        error: null,
      },
    ],
    phone_numbers: [
      { data: { e164: "+15551234567", forwarding_verified_at: "2026-01-01" }, error: null },
    ],
    call_logs: [{ count: 1, error: null }],
    offerings: [{ count: 3, error: null }],
    resources: [{ count: 0, error: null }],
    memberships: [{ count: 2, error: null }],
    adapter_connections: [{ count: 1, error: null }],
  };
}

describe("GET /api/tenant/setup-progress", () => {
  it("401s when unauthenticated", async () => {
    mockGetUser = async () => ({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("403s without a tenant_id claim", async () => {
    mockGetUser = async () => ({ data: { user: { id: "u1", app_metadata: {} } } });
    mockClaimsAppMetadata = {};
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("marks every required step done and complete:true for a fully set-up tenant", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    mockClaimsAppMetadata = { tenant_id: "t1", role: "owner" };
    serverQueue = fullyDoneQueue();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      complete: boolean;
      requiredDone: number;
      requiredTotal: number;
      steps: Array<{ id: string; done: boolean }>;
    };
    expect(body.complete).toBe(true);
    expect(body.requiredDone).toBe(body.requiredTotal);
    const byId = Object.fromEntries(body.steps.map((s) => [s.id, s.done]));
    expect(byId["team_invited"]).toBe(true);
    expect(byId["integrations"]).toBe(true);
  });

  it("marks a brand-new tenant incomplete with no required step falsely done", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    mockClaimsAppMetadata = { tenant_id: "t1", role: "owner" };
    serverQueue = {
      tenants: [
        {
          data: { status: "trialing", a2p_status: "pending_verification", business_hours: {} },
          error: null,
        },
      ],
      agent_configs: [{ data: null, error: null }],
      phone_numbers: [{ data: null, error: null }],
      call_logs: [{ count: 0, error: null }],
      offerings: [{ count: 0, error: null }],
      resources: [{ count: 0, error: null }],
      memberships: [{ count: 1, error: null }],
      adapter_connections: [{ count: 0, error: null }],
    };
    const res = await GET();
    const body = (await res.json()) as { complete: boolean; requiredDone: number };
    expect(body.complete).toBe(false);
    expect(body.requiredDone).toBe(0);
  });

  it("does not let the optional team/integration steps count toward requiredTotal", async () => {
    mockGetUser = async () => ({ data: { user: mockUser } });
    mockClaimsAppMetadata = { tenant_id: "t1", role: "owner" };
    serverQueue = fullyDoneQueue();
    serverQueue["memberships"] = [{ count: 1, error: null }];
    serverQueue["adapter_connections"] = [{ count: 0, error: null }];
    const res = await GET();
    const body = (await res.json()) as { complete: boolean };
    expect(body.complete).toBe(true);
  });
});
