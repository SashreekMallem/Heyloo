import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "in", "eq", "maybeSingle", "upsert", "insert"]) {
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

const { GET, POST } = await import("./route");

function postRequest(body: unknown) {
  return new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
}

describe("GET /api/admin/admin-platform-settings/fees", () => {
  it("401s when unauthenticated", async () => {
    mockSession = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns defaults for every vertical when nothing is configured", async () => {
    mockSession = { user: adminUser };
    serviceQueue = { platform_settings: [{ data: [], error: null }] };
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fees: Record<string, { setup_fee_enabled: boolean }> };
    expect(body.fees["dental"]?.setup_fee_enabled).toBe(false);
  });

  it("merges a stored key over the defaults", async () => {
    mockSession = { user: adminUser };
    serviceQueue = {
      platform_settings: [
        {
          data: [
            {
              key: "fees_dental",
              value: {
                setup_fee_enabled: true,
                setup_fee_cents: 19900,
                white_glove_enabled: false,
                white_glove_fee_cents: 0,
                white_glove_description: "",
              },
            },
          ],
          error: null,
        },
      ],
    };
    const res = await GET();
    const body = (await res.json()) as { fees: Record<string, { setup_fee_cents: number }> };
    expect(body.fees["dental"]?.setup_fee_cents).toBe(19900);
  });
});

describe("POST /api/admin/admin-platform-settings/fees", () => {
  it("rejects an unknown vertical", async () => {
    mockSession = { user: adminUser };
    const res = await POST(
      postRequest({
        vertical: "bogus",
        setup_fee_enabled: true,
        setup_fee_cents: 100,
        white_glove_enabled: false,
        white_glove_fee_cents: 0,
        white_glove_description: "",
      }),
    );
    expect(res.status).toBe(422);
  });

  it("rejects a negative fee", async () => {
    mockSession = { user: adminUser };
    const res = await POST(
      postRequest({
        vertical: "dental",
        setup_fee_enabled: true,
        setup_fee_cents: -1,
        white_glove_enabled: false,
        white_glove_fee_cents: 0,
        white_glove_description: "",
      }),
    );
    expect(res.status).toBe(422);
  });

  it("saves and audits the write", async () => {
    mockSession = { user: adminUser };
    serviceQueue = {
      platform_settings: [{ data: null, error: null }, { error: null }],
      admin_actions: [{ data: null, error: null }],
    };
    const res = await POST(
      postRequest({
        vertical: "dental",
        setup_fee_enabled: true,
        setup_fee_cents: 19900,
        white_glove_enabled: false,
        white_glove_fee_cents: 0,
        white_glove_description: "",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fees: { setup_fee_cents: number } };
    expect(body.fees.setup_fee_cents).toBe(19900);
  });
});
