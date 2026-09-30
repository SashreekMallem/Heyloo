import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "in",
    "order",
    "limit",
    "maybeSingle",
    "update",
    "insert",
  ]) {
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

const adminUser = { id: "admin1", app_metadata: { platform_admin: true }, aal: "aal2" };
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
        const s = mockSession?.user as { app_metadata?: unknown; aal?: string } | undefined;
        return {
          data: { claims: { app_metadata: s?.app_metadata ?? {}, aal: s?.aal } },
          error: null,
        };
      },
    },
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createSupabaseServiceRoleServerClient: () => ({ from: makeFrom(serviceQueue) }),
}));

const { GET, PATCH } = await import("./route");

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/admin/admin-support-requests/s1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/admin-support-requests/[id]", () => {
  it("404s for an unknown ticket", async () => {
    mockSession = { user: adminUser };
    serviceQueue = { support_requests: [{ data: null, error: null }] };
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns the ticket with tenant name and its notes", async () => {
    mockSession = { user: adminUser };
    serviceQueue = {
      support_requests: [
        {
          data: {
            id: "s1",
            tenant_id: "t1",
            subject: "Help",
            body: "b",
            priority: "medium",
            status: "open",
            call_id: null,
            booking_id: null,
            created_at: "x",
            updated_at: "y",
          },
          error: null,
        },
      ],
      tenants: [{ data: { name: "Acme", vertical: "dental" }, error: null }],
      support_request_notes: [
        {
          data: [
            { id: "n1", body: "reply", visible_to_tenant: true, created_at: "z", author_id: "u1" },
          ],
          error: null,
        },
      ],
      platform_admins: [{ data: [], error: null }],
    };
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ticket: { tenant_name: string }; notes: unknown[] };
    expect(body.ticket.tenant_name).toBe("Acme");
    expect(body.notes).toHaveLength(1);
  });

  // COCKPIT-F25: the thread labels who wrote each note.
  it("marks each note's author as the support team or the tenant", async () => {
    mockSession = { user: adminUser };
    serviceQueue = {
      support_requests: [
        {
          data: { id: "s1", tenant_id: "t1", subject: "Help", body: "b", status: "open" },
          error: null,
        },
      ],
      tenants: [{ data: { name: "Acme", vertical: "dental" }, error: null }],
      support_request_notes: [
        {
          data: [
            {
              id: "n1",
              body: "from tenant",
              visible_to_tenant: true,
              created_at: "1",
              author_id: "u1",
            },
            {
              id: "n2",
              body: "from us",
              visible_to_tenant: true,
              created_at: "2",
              author_id: "admin1",
            },
            {
              id: "n3",
              body: "internal",
              visible_to_tenant: false,
              created_at: "3",
              author_id: "admin1",
            },
          ],
          error: null,
        },
      ],
      platform_admins: [{ data: [{ user_id: "admin1" }], error: null }],
    };
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "s1" }),
    });
    const body = (await res.json()) as {
      notes: { id: string; author_role: string; visible_to_tenant: boolean }[];
    };
    expect(body.notes.map((n) => [n.id, n.author_role, n.visible_to_tenant])).toEqual([
      ["n1", "tenant", true],
      ["n2", "admin", true],
      ["n3", "admin", false],
    ]);
  });
});

describe("PATCH /api/admin/admin-support-requests/[id]", () => {
  it("401s when unauthenticated", async () => {
    mockSession = null;
    const res = await PATCH(patchRequest({ status: "resolved" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid status", async () => {
    mockSession = { user: adminUser };
    const res = await PATCH(patchRequest({ status: "bogus" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(422);
  });

  it("404s for an unknown ticket", async () => {
    mockSession = { user: adminUser };
    serviceQueue = { support_requests: [{ data: null, error: null }] };
    const res = await PATCH(patchRequest({ status: "resolved" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(404);
  });

  it("updates status and writes an admin_actions row", async () => {
    mockSession = { user: adminUser };
    serviceQueue = {
      support_requests: [
        { data: { id: "s1", status: "open" }, error: null },
        { data: { id: "s1", status: "resolved" }, error: null },
      ],
      admin_actions: [{ data: null, error: null }],
    };
    const res = await PATCH(patchRequest({ status: "resolved" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ticket: { id: "s1", status: "resolved" } });
  });
});
