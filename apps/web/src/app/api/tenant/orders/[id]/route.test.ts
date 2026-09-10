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
    auth: { getUser: () => mockGetUser() },
    from: makeFrom(serverQueue),
  }),
}));

const { PATCH } = await import("./route");

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/tenant/orders/o1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/tenant/orders/[id]", () => {
  it("401s when unauthenticated", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: null } });
    const res = await PATCH(patchRequest({ status: "completed" }), {
      params: Promise.resolve({ id: "o1" }),
    });
    expect(res.status).toBe(401);
  });

  it("403s when the caller has no tenant_id claim", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: { id: "u1", app_metadata: {} } } });
    const res = await PATCH(patchRequest({ status: "completed" }), {
      params: Promise.resolve({ id: "o1" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a status outside the enum", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await PATCH(patchRequest({ status: "bogus" }), {
      params: Promise.resolve({ id: "o1" }),
    });
    expect(res.status).toBe(422);
  });

  it("404s when the order doesn't belong to the caller's tenant", async () => {
    serverQueue = { orders: [{ data: null, error: null }] };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await PATCH(patchRequest({ status: "completed" }), {
      params: Promise.resolve({ id: "o1" }),
    });
    expect(res.status).toBe(404);
  });

  it("updates status for an order scoped to the caller's tenant", async () => {
    serverQueue = { orders: [{ data: { id: "o1" }, error: null }, { error: null }] };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await PATCH(patchRequest({ status: "completed" }), {
      params: Promise.resolve({ id: "o1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
