import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle", "upsert", "delete", "insert"]) {
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

const { PUT, DELETE } = await import("./route");

function putRequest(body: unknown) {
  return new Request("http://localhost/x", { method: "PUT", body: JSON.stringify(body) });
}

describe("PUT /api/admin/admin-referral-partners/[id]/overrides/[vertical]", () => {
  it("rejects an unknown vertical", async () => {
    mockSession = { user: adminUser };
    const res = await PUT(putRequest({ rate_bps: 1000 }), {
      params: Promise.resolve({ id: "p1", vertical: "bogus" }),
    });
    expect(res.status).toBe(422);
  });

  it("404s when the partner doesn't exist", async () => {
    mockSession = { user: adminUser };
    serviceQueue = { referral_partners: [{ data: null, error: null }] };
    const res = await PUT(putRequest({ rate_bps: 1000 }), {
      params: Promise.resolve({ id: "p1", vertical: "dental" }),
    });
    expect(res.status).toBe(404);
  });

  it("upserts the override and audits the write", async () => {
    mockSession = { user: adminUser };
    serviceQueue = {
      referral_partners: [{ data: { id: "p1" }, error: null }],
      referral_partner_vertical_overrides: [
        { data: null, error: null },
        { data: { referral_partner_id: "p1", vertical: "dental", rate_bps: 1500 }, error: null },
      ],
      admin_actions: [{ data: null, error: null }],
    };
    const res = await PUT(putRequest({ rate_bps: 1500 }), {
      params: Promise.resolve({ id: "p1", vertical: "dental" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { override: { rate_bps: number } };
    expect(body.override.rate_bps).toBe(1500);
  });
});

describe("DELETE /api/admin/admin-referral-partners/[id]/overrides/[vertical]", () => {
  it("is a no-op ok:true when no override exists", async () => {
    mockSession = { user: adminUser };
    serviceQueue = { referral_partner_vertical_overrides: [{ data: null, error: null }] };
    const res = await DELETE(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "p1", vertical: "dental" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("deletes an existing override and audits the write", async () => {
    mockSession = { user: adminUser };
    serviceQueue = {
      referral_partner_vertical_overrides: [
        { data: { referral_partner_id: "p1", vertical: "dental", rate_bps: 1500 }, error: null },
        { data: null, error: null },
      ],
      admin_actions: [{ data: null, error: null }],
    };
    const res = await DELETE(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "p1", vertical: "dental" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
