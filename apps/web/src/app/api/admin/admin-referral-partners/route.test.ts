import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "order"]) {
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

const { GET } = await import("./route");

describe("GET /api/admin/admin-referral-partners", () => {
  it("401s when unauthenticated", async () => {
    mockSession = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("403s for a non-admin", async () => {
    mockSession = { user: { id: "u1", app_metadata: {} } };
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("lists partners with their commission terms", async () => {
    mockSession = { user: adminUser };
    serviceQueue = {
      referral_partners: [
        {
          data: [
            {
              id: "p1",
              name: "Acme Referrals",
              email: "a@x.com",
              payout_method: "paypal",
              w9_status: "verified",
              ytd_payout_cents: 5000,
              rate_bps: 1000,
              commission_base: "gross_profit",
              duration_months: 12,
            },
          ],
          error: null,
        },
      ],
    };
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ rate_bps: number }> };
    expect(body.rows[0]?.rate_bps).toBe(1000);
  });
});
