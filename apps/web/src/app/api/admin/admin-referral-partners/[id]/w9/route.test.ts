import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle", "update", "insert"]) {
    obj[method] = vi.fn(() => obj);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const updates: unknown[] = [];
function makeFrom(queue: Record<string, unknown[]>) {
  return vi.fn((table: string) => {
    const q = queue[table];
    const result = q?.length ? q.shift() : { data: null, error: null };
    const c = chain(result);
    const originalUpdate = c["update"] as (v: unknown) => unknown;
    c["update"] = vi.fn((values: unknown) => {
      updates.push(values);
      return originalUpdate(values);
    });
    return c;
  });
}

const adminUser = { id: "admin1", app_metadata: { platform_admin: true } };
let mockSession: { user: unknown } | null = { user: adminUser };
let serviceQueue: Record<string, unknown[]> = {};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: mockSession } }),
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

const { PATCH } = await import("./route");

const req = (body: unknown) =>
  new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ id: "p1" }) };

describe("PATCH /api/admin/admin-referral-partners/[id]/w9 (PT-04)", () => {
  it("rejects a non-admin", async () => {
    mockSession = { user: { id: "u1", app_metadata: {} } };
    const res = await PATCH(req({ w9_status: "verified" }), ctx);
    expect([401, 403]).toContain(res.status);
  });

  it("rejects an unknown status", async () => {
    mockSession = { user: adminUser };
    const res = await PATCH(req({ w9_status: "approved" }), ctx);
    expect(res.status).toBe(422);
  });

  it("404s for an unknown partner", async () => {
    mockSession = { user: adminUser };
    serviceQueue = { referral_partners: [{ data: null, error: null }] };
    const res = await PATCH(req({ w9_status: "verified" }), ctx);
    expect(res.status).toBe(404);
  });

  it("sets the status and writes an admin_actions row", async () => {
    mockSession = { user: adminUser };
    updates.length = 0;
    serviceQueue = {
      referral_partners: [
        { data: { id: "p1", w9_status: "not_submitted" }, error: null },
        { data: { id: "p1", w9_status: "verified" }, error: null },
      ],
      admin_actions: [{ data: null, error: null }],
    };
    const res = await PATCH(req({ w9_status: "verified" }), ctx);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { partner: { w9_status: string } }).partner.w9_status).toBe(
      "verified",
    );
    expect(updates).toContainEqual({ w9_status: "verified" });
  });
});
