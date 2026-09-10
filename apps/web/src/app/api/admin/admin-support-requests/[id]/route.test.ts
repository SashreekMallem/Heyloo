import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "maybeSingle", "update", "insert"]) {
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

const adminUser = { id: "admin1", app_metadata: { platform_admin: true } };
let mockSession: { user: unknown } | null = { user: adminUser };
let serviceQueue: Record<string, unknown[]> = {};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: { getSession: async () => ({ data: { session: mockSession } }) },
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
    };
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ticket: { tenant_name: string }; notes: unknown[] };
    expect(body.ticket.tenant_name).toBe("Acme");
    expect(body.notes).toHaveLength(1);
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
