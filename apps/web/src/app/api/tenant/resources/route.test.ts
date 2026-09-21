import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "insert", "single"]) {
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
    const result = q?.length ? q.shift() : { data: null, error: null };
    return chain(result);
  });
}

const mockUser = { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } };

let serverQueue: Record<string, unknown[]> = {};
let mockGetUser: () => Promise<{ data: { user: unknown } }> = async () => ({
  data: { user: null },
});
// AUTH-1 (docs/BUILD_NOTES.md): set only by the dedicated regression test
// below to decouple `getClaims()`'s answer from `getUser()`'s, proving the
// route honors the JWT-only claim rather than `user.app_metadata`.
let mockClaimsOverride: unknown | undefined;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getUser: () => mockGetUser(),
      // AUTH-1 (docs/BUILD_NOTES.md): the route now reads claims via
      // `auth.getClaims()`, not `user.app_metadata` — bridge it off the
      // SAME mocked user so every existing `mockGetUser` scenario above
      // still drives the route's authorization outcome unchanged, unless a
      // test explicitly decouples it via `mockClaimsOverride`.
      getClaims: async () => {
        if (mockClaimsOverride !== undefined) {
          return { data: { claims: { app_metadata: mockClaimsOverride } }, error: null };
        }
        const { data } = await mockGetUser();
        const u = data.user as { app_metadata?: unknown } | null;
        return { data: { claims: { app_metadata: u?.app_metadata ?? {} } }, error: null };
      },
    },
    from: makeFrom(serverQueue),
  }),
}));

// ONBOARD-1: the route's own POST handler calls this (service-role,
// narrowly scoped) after every resource insert to populate
// `availability_slots` immediately rather than waiting for the next
// nightly `fn_cron_availability_rollforward` run — see route.ts's own
// comment and docs/BUILD_NOTES.md ONBOARD-1.
const mockRpc = vi.fn(async () => ({ data: null, error: null }) as { data: null; error: unknown });
vi.mock("@/lib/supabase/service-role", () => ({
  createSupabaseServiceRoleServerClient: () => ({ rpc: mockRpc }),
}));

const { GET, POST } = await import("./route");

function postRequest(body: unknown) {
  return new Request("http://localhost/api/tenant/resources", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("GET /api/tenant/resources", () => {
  it("401s when unauthenticated", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("403s with no tenant_id claim", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: { id: "u1", app_metadata: {} } } });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns the tenant's resources", async () => {
    serverQueue = { resources: [{ data: [{ id: "r1", name: "Room 1" }], error: null }] };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ resources: [{ id: "r1", name: "Room 1" }] });
  });

  it("AUTH-1 regression: honors a tenant_id claim present ONLY in the JWT (auth.getClaims()), absent from user.app_metadata", async () => {
    serverQueue = { resources: [{ data: [], error: null }] };
    mockGetUser = async () => ({ data: { user: { id: "u1", app_metadata: {} } } });
    mockClaimsOverride = { tenant_id: "t1", role: "owner" };
    const res = await GET();
    expect(res.status).toBe(200);
    mockClaimsOverride = undefined;
  });

  it("AUTH-1 regression: 403s when the JWT's own claims carry no tenant_id, even if user.app_metadata (stale) has one", async () => {
    serverQueue = {};
    mockGetUser = async () => ({
      data: { user: { id: "u1", app_metadata: { tenant_id: "stale-tenant", role: "owner" } } },
    });
    mockClaimsOverride = {};
    const res = await GET();
    expect(res.status).toBe(403);
    mockClaimsOverride = undefined;
  });
});

describe("POST /api/tenant/resources", () => {
  it("401s when unauthenticated", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: null } });
    const res = await POST(postRequest({ type: "room", name: "Room 1" }));
    expect(res.status).toBe(401);
  });

  it("422s on an invalid type", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ type: "bogus", name: "Room 1" }));
    expect(res.status).toBe(422);
  });

  it("422s on a blank name", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ type: "room", name: "" }));
    expect(res.status).toBe(422);
  });

  it("creates a resource scoped to the caller's tenant", async () => {
    serverQueue = { resources: [{ data: { id: "r1" }, error: null }] };
    mockGetUser = async () => ({ data: { user: mockUser } });
    mockRpc.mockClear();
    const res = await POST(
      postRequest({ type: "room", name: "Room 1", capacity: 2, room_type: "queen" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "r1" });
    // ONBOARD-1: the new resource's own id + the caller's own (JWT-derived)
    // tenant_id are passed, never anything client-supplied.
    expect(mockRpc).toHaveBeenCalledWith("fn_regenerate_availability_slots", {
      p_tenant_id: "t1",
      p_resource_id: "r1",
      p_days_ahead: null,
    });
  });

  it("ONBOARD-1: still returns 200 (resource already created) when availability-slot regeneration itself errors", async () => {
    serverQueue = { resources: [{ data: { id: "r2" }, error: null }] };
    mockGetUser = async () => ({ data: { user: mockUser } });
    mockRpc.mockClear();
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const res = await POST(postRequest({ type: "bay", name: "Bay 1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "r2" });
  });
});
