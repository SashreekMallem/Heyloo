import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
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
let mockGetSession: () => Promise<{ data: { session: unknown } }> = async () => ({
  data: { session: null },
});

const callEdgeFunctionMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getSession: () => mockGetSession(),
      // AUTH-1 (docs/BUILD_NOTES.md): the route now reads claims via
      // `auth.getClaims()`, not `session.user.app_metadata` — bridge it
      // off the SAME mocked session so every existing `mockGetSession`
      // scenario above still drives the route's authorization outcome.
      getClaims: async () => {
        const { data } = await mockGetSession();
        const s = data.session as { user?: { app_metadata?: unknown } } | null;
        return { data: { claims: { app_metadata: s?.user?.app_metadata ?? {} } }, error: null };
      },
    },
    from: makeFrom(serverQueue),
  }),
}));

vi.mock("@/lib/edge-functions", () => ({
  callEdgeFunction: (...args: unknown[]) => callEdgeFunctionMock(...args),
}));

const { POST } = await import("./route");

function postRequest() {
  return new Request("http://localhost/api/tenant/payment-links/pl1/resend", { method: "POST" });
}

describe("POST /api/tenant/payment-links/[id]/resend", () => {
  it("401s when unauthenticated", async () => {
    serverQueue = {};
    mockGetSession = async () => ({ data: { session: null } });
    const res = await POST(postRequest(), { params: Promise.resolve({ id: "pl1" }) });
    expect(res.status).toBe(401);
  });

  it("404s when the payment link doesn't belong to the caller's tenant", async () => {
    serverQueue = { payment_links: [{ data: null, error: null }] };
    mockGetSession = async () => ({
      data: { session: { access_token: "tok", user: mockUser } },
    });
    const res = await POST(postRequest(), { params: Promise.resolve({ id: "pl1" }) });
    expect(res.status).toBe(404);
  });

  it("409s when the link is already paid", async () => {
    serverQueue = { payment_links: [{ data: { id: "pl1", status: "paid" }, error: null }] };
    mockGetSession = async () => ({
      data: { session: { access_token: "tok", user: mockUser } },
    });
    const res = await POST(postRequest(), { params: Promise.resolve({ id: "pl1" }) });
    expect(res.status).toBe(409);
  });

  it("proxies to the edge function for a pending link owned by the caller", async () => {
    serverQueue = { payment_links: [{ data: { id: "pl1", status: "pending" }, error: null }] };
    mockGetSession = async () => ({
      data: { session: { access_token: "tok", user: mockUser } },
    });
    callEdgeFunctionMock.mockResolvedValueOnce({ status: 200, body: { ok: true } });
    const res = await POST(postRequest(), { params: Promise.resolve({ id: "pl1" }) });
    expect(callEdgeFunctionMock).toHaveBeenCalledWith(
      "api-payment-link-resend",
      expect.objectContaining({
        method: "POST",
        accessToken: "tok",
        body: { tenant_id: "t1", payment_link_id: "pl1" },
      }),
    );
    expect(res.status).toBe(200);
  });
});
