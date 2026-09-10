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
  return new Request("http://localhost/api/tenant/offerings", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("GET /api/tenant/offerings", () => {
  it("401s when unauthenticated", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the tenant's offerings", async () => {
    serverQueue = { offerings: [{ data: [{ id: "o1", name: "Margherita" }], error: null }] };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ offerings: [{ id: "o1", name: "Margherita" }] });
  });
});

describe("POST /api/tenant/offerings", () => {
  it("401s when unauthenticated", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: null } });
    const res = await POST(postRequest({ name: "Margherita" }));
    expect(res.status).toBe(401);
  });

  it("422s on a blank name", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ name: "" }));
    expect(res.status).toBe(422);
  });

  it("422s on a negative price", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ name: "Margherita", price_cents: -100 }));
    expect(res.status).toBe(422);
  });

  it("creates an offering with modifiers and allergens", async () => {
    serverQueue = { offerings: [{ data: { id: "o1" }, error: null }] };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(
      postRequest({
        name: "Margherita",
        price_cents: 1400,
        metadata: {
          modifiers: [{ name: "Extra cheese", price_cents: 150 }],
          allergens: ["dairy", "gluten"],
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "o1" });
  });
});
