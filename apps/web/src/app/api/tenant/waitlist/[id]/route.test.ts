import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle", "update"]) {
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

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getUser: () => mockGetUser(),
      // AUTH-1 (docs/BUILD_NOTES.md): the route now reads claims via
      // `auth.getClaims()`, not `user.app_metadata` — bridge it off the
      // SAME mocked user so every existing `mockGetUser` scenario above
      // still drives the route's authorization outcome unchanged.
      getClaims: async () => {
        const { data } = await mockGetUser();
        const u = data.user as { app_metadata?: unknown } | null;
        return { data: { claims: { app_metadata: u?.app_metadata ?? {} } }, error: null };
      },
    },
    from: makeFrom(serverQueue),
  }),
}));

const { PATCH } = await import("./route");

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/tenant/waitlist/w1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/tenant/waitlist/[id]", () => {
  it("401s when unauthenticated", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: null } });
    const res = await PATCH(patchRequest({ status: "expired" }), {
      params: Promise.resolve({ id: "w1" }),
    });
    expect(res.status).toBe(401);
  });

  it("403s when the caller has no tenant_id claim", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: { id: "u1", app_metadata: {} } } });
    const res = await PATCH(patchRequest({ status: "expired" }), {
      params: Promise.resolve({ id: "w1" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a status outside the enum", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await PATCH(patchRequest({ status: "bogus" }), {
      params: Promise.resolve({ id: "w1" }),
    });
    expect(res.status).toBe(422);
  });

  it("404s when the entry doesn't belong to the caller's tenant", async () => {
    serverQueue = { waitlist_entries: [{ data: null, error: null }] };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await PATCH(patchRequest({ status: "expired" }), {
      params: Promise.resolve({ id: "w1" }),
    });
    expect(res.status).toBe(404);
  });

  it("updates status for an entry scoped to the caller's tenant", async () => {
    serverQueue = {
      waitlist_entries: [{ data: { id: "w1" }, error: null }, { error: null }],
    };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await PATCH(patchRequest({ status: "expired" }), {
      params: Promise.resolve({ id: "w1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
