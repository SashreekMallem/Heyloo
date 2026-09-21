import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "maybeSingle", "update", "insert"]) {
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

const { GET, PATCH } = await import("./route");

function patchRequest(body: unknown) {
  return new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) });
}

describe("GET /api/admin/admin-referral-partners/[id]", () => {
  it("404s for an unknown partner", async () => {
    mockSession = { user: adminUser };
    serviceQueue = { referral_partners: [{ data: null, error: null }] };
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "p1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns the partner and its vertical overrides", async () => {
    mockSession = { user: adminUser };
    serviceQueue = {
      referral_partners: [
        {
          data: {
            id: "p1",
            name: "Acme",
            rate_bps: 1000,
            commission_base: "revenue",
            duration_months: null,
          },
          error: null,
        },
      ],
      referral_partner_vertical_overrides: [
        {
          data: [
            { vertical: "dental", rate_bps: 1500, commission_base: null, duration_months: null },
          ],
          error: null,
        },
      ],
    };
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "p1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { overrides: Array<{ vertical: string }> };
    expect(body.overrides[0]?.vertical).toBe("dental");
  });
});

describe("PATCH /api/admin/admin-referral-partners/[id]", () => {
  it("rejects a rate_bps out of range", async () => {
    mockSession = { user: adminUser };
    const res = await PATCH(
      patchRequest({ rate_bps: 20000, commission_base: "revenue", duration_months: null }),
      {
        params: Promise.resolve({ id: "p1" }),
      },
    );
    expect(res.status).toBe(422);
  });

  it("404s for an unknown partner", async () => {
    mockSession = { user: adminUser };
    serviceQueue = { referral_partners: [{ data: null, error: null }] };
    const res = await PATCH(
      patchRequest({ rate_bps: 1000, commission_base: "revenue", duration_months: null }),
      {
        params: Promise.resolve({ id: "p1" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("updates commission terms and writes an admin_actions row", async () => {
    mockSession = { user: adminUser };
    serviceQueue = {
      referral_partners: [
        {
          data: {
            id: "p1",
            rate_bps: null,
            commission_base: "gross_profit",
            duration_months: null,
          },
          error: null,
        },
        {
          data: { id: "p1", rate_bps: 1000, commission_base: "revenue", duration_months: 12 },
          error: null,
        },
      ],
      admin_actions: [{ data: null, error: null }],
    };
    const res = await PATCH(
      patchRequest({ rate_bps: 1000, commission_base: "revenue", duration_months: 12 }),
      {
        params: Promise.resolve({ id: "p1" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { partner: { rate_bps: number } };
    expect(body.partner.rate_bps).toBe(1000);
  });
});
