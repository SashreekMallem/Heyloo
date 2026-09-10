import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "order",
    "limit",
    "in",
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

const { GET } = await import("./route");

describe("GET /api/admin/admin-support-requests", () => {
  it("401s when unauthenticated", async () => {
    mockSession = null;
    const res = await GET(new Request("http://localhost/api/admin/admin-support-requests"));
    expect(res.status).toBe(401);
  });

  it("403s when the caller lacks platform_admin", async () => {
    mockSession = { user: { id: "u1", app_metadata: {} } };
    const res = await GET(new Request("http://localhost/api/admin/admin-support-requests"));
    expect(res.status).toBe(403);
  });

  it("lists tickets with the referred tenant's name resolved", async () => {
    mockSession = { user: adminUser };
    serviceQueue = {
      support_requests: [
        {
          data: [
            {
              id: "s1",
              tenant_id: "t1",
              subject: "Help",
              priority: "medium",
              status: "open",
              created_at: "x",
              updated_at: "y",
            },
          ],
          error: null,
        },
      ],
      tenants: [{ data: [{ id: "t1", name: "Acme Dental" }], error: null }],
    };
    const res = await GET(new Request("http://localhost/api/admin/admin-support-requests"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ tenant_name: string }> };
    expect(body.rows[0]?.tenant_name).toBe("Acme Dental");
  });
});
