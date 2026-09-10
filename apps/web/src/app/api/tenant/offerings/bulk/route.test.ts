import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "insert"]) {
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

const { POST } = await import("./route");

function postRequest(body: unknown) {
  return new Request("http://localhost/api/tenant/offerings/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/tenant/offerings/bulk", () => {
  it("401s when unauthenticated", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: null } });
    const res = await POST(postRequest({ offerings: [{ name: "Margherita" }] }));
    expect(res.status).toBe(401);
  });

  it("422s on an empty batch", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ offerings: [] }));
    expect(res.status).toBe(422);
  });

  it("422s when any row in the batch is invalid", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ offerings: [{ name: "Margherita" }, { name: "" }] }));
    expect(res.status).toBe(422);
  });

  it("inserts every row in the batch scoped to the caller's tenant", async () => {
    serverQueue = { offerings: [{ data: [{ id: "o1" }, { id: "o2" }], error: null }] };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(
      postRequest({ offerings: [{ name: "Margherita" }, { name: "Caesar Salad" }] }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, created: 2 });
  });
});
