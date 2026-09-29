import { describe, expect, it, vi } from "vitest";

/** Every payload passed to `.insert(...)`, so a test can assert what was written. */
const inserts: Record<string, unknown>[] = [];

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj["insert"] = vi.fn((payload: Record<string, unknown>) => {
    inserts.push(payload);
    return obj;
  });
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

const adminUser = { id: "admin1", app_metadata: { platform_admin: true } };
let mockSession: { user: unknown } | null = { user: adminUser };
let serviceQueue: Record<string, unknown[]> = {};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: mockSession } }),
      // AUTH-1 (docs/BUILD_NOTES.md): `requireAdminApiSession` now reads
      // claims via `auth.getClaims()`, not `session.user.app_metadata` —
      // bridge it off the SAME mocked session so every existing
      // `mockSession` scenario above still drives the route's
      // authorization outcome unchanged.
      getClaims: async () => {
        const s = mockSession?.user as { app_metadata?: unknown } | undefined;
        return { data: { claims: { app_metadata: s?.app_metadata ?? {} } }, error: null };
      },
    },
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createSupabaseServiceRoleServerClient: () => ({ from: makeFrom(serviceQueue) }),
}));

const { POST } = await import("./route");

function postRequest(body: unknown) {
  return new Request("http://localhost/api/admin/admin-support-requests/s1/notes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/admin-support-requests/[id]/notes", () => {
  it("401s when unauthenticated", async () => {
    mockSession = null;
    const res = await POST(postRequest({ body: "hi" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(401);
  });

  it("rejects an empty body", async () => {
    mockSession = { user: adminUser };
    const res = await POST(postRequest({ body: "  " }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(422);
  });

  it("404s for an unknown ticket", async () => {
    mockSession = { user: adminUser };
    serviceQueue = { support_requests: [{ data: null, error: null }] };
    const res = await POST(postRequest({ body: "hi" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(404);
  });

  it("inserts a tenant-visible reply note authored by the admin", async () => {
    mockSession = { user: adminUser };
    serviceQueue = {
      support_requests: [{ data: { id: "s1" }, error: null }],
      support_request_notes: [
        {
          data: {
            id: "n1",
            body: "hi",
            visible_to_tenant: true,
            created_at: "x",
            author_id: "admin1",
          },
          error: null,
        },
      ],
    };
    const res = await POST(postRequest({ body: "hi" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { note: { author_id: string; visible_to_tenant: boolean } };
    expect(body.note.author_id).toBe("admin1");
    expect(body.note.visible_to_tenant).toBe(true);
  });

  // COCKPIT-F25: an internal-only note option.
  it("defaults to tenant-visible when the flag is absent", async () => {
    inserts.length = 0;
    mockSession = { user: adminUser };
    serviceQueue = {
      support_requests: [{ data: { id: "s1" }, error: null }],
      support_request_notes: [{ data: { id: "n1" }, error: null }],
    };
    await POST(postRequest({ body: "hi" }), { params: Promise.resolve({ id: "s1" }) });
    expect(inserts[0]).toMatchObject({ body: "hi", visible_to_tenant: true, author_id: "admin1" });
  });

  it("stores an internal note with visible_to_tenant=false", async () => {
    inserts.length = 0;
    mockSession = { user: adminUser };
    serviceQueue = {
      support_requests: [{ data: { id: "s1" }, error: null }],
      support_request_notes: [{ data: { id: "n1", visible_to_tenant: false }, error: null }],
    };
    const res = await POST(postRequest({ body: "call them back", visible_to_tenant: false }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(200);
    expect(inserts[0]).toMatchObject({ body: "call them back", visible_to_tenant: false });
  });

  it("rejects a non-boolean visible_to_tenant instead of guessing", async () => {
    inserts.length = 0;
    mockSession = { user: adminUser };
    const res = await POST(postRequest({ body: "hi", visible_to_tenant: "no" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(422);
    expect(inserts).toHaveLength(0);
  });
});
