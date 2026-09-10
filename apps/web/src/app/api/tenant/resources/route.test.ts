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

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: { getUser: () => mockGetUser() },
    from: makeFrom(serverQueue),
  }),
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
    const res = await POST(
      postRequest({ type: "room", name: "Room 1", capacity: 2, room_type: "queen" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "r1" });
  });
});
