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

function makeFrom(queue: Record<string, unknown[]>) {
  return vi.fn((table: string) => {
    const q = queue[table];
    const result = q?.length ? q.shift() : { data: null, error: null };
    return chain(result);
  });
}

const mockUser = { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } };

let serverQueue: Record<string, unknown[]> = {};
let serviceQueue: Record<string, unknown[]> = {};
let mockGetUser: () => Promise<{ data: { user: unknown } }> = async () => ({
  data: { user: null },
});
let rpcMock = vi.fn(async (..._args: unknown[]) => ({ data: null, error: null }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getUser: () => mockGetUser(),
      // AUTH-1 (docs/BUILD_NOTES.md): the route now reads claims via
      // `auth.getClaims()`, not `user.app_metadata` — bridge it off the
      // SAME mocked user so every existing `mockGetUser` scenario above
      // still drives the route's authorization outcome unchanged.
      getClaims: async () => {
        const { data } = await mockGetUser();
        const u = data.user as { app_metadata?: unknown } | null;
        return { data: { claims: { app_metadata: u?.app_metadata ?? {} } }, error: null };
      },
    },
    from: makeFrom(serverQueue),
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createSupabaseServiceRoleServerClient: () => ({
    from: makeFrom(serviceQueue),
    rpc: (...args: unknown[]) => rpcMock(...args),
  }),
}));

const { PATCH } = await import("./route");

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/tenant/orders/o1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/tenant/orders/[id]", () => {
  it("401s when unauthenticated", async () => {
    serverQueue = {};
    serviceQueue = {};
    mockGetUser = async () => ({ data: { user: null } });
    const res = await PATCH(patchRequest({ status: "completed" }), {
      params: Promise.resolve({ id: "o1" }),
    });
    expect(res.status).toBe(401);
  });

  it("403s when the caller has no tenant_id claim", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: { id: "u1", app_metadata: {} } } });
    const res = await PATCH(patchRequest({ status: "completed" }), {
      params: Promise.resolve({ id: "o1" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a status outside the enum", async () => {
    serverQueue = {};
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await PATCH(patchRequest({ status: "bogus" }), {
      params: Promise.resolve({ id: "o1" }),
    });
    expect(res.status).toBe(422);
  });

  it("404s when the order doesn't belong to the caller's tenant", async () => {
    serverQueue = { orders: [{ data: null, error: null }] };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await PATCH(patchRequest({ status: "completed" }), {
      params: Promise.resolve({ id: "o1" }),
    });
    expect(res.status).toBe(404);
  });

  it("updates status for an order scoped to the caller's tenant (no SMS for a non-'ready' transition)", async () => {
    serverQueue = {
      orders: [
        { data: { id: "o1", status: "preparing", customer_id: "c1" }, error: null },
        { error: null },
      ],
    };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await PATCH(patchRequest({ status: "completed" }), {
      params: Promise.resolve({ id: "o1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sms_queued: false });
  });

  it("GAP_REGISTER.md §2 Restaurant item 6: sends an order_ready SMS on a transition into 'ready'", async () => {
    serverQueue = {
      orders: [
        { data: { id: "o1", status: "preparing", customer_id: "c1" }, error: null },
        { error: null },
      ],
    };
    serviceQueue = {
      customers: [{ data: { phone_e164: "+15551234567", sms_opt_out: false }, error: null }],
      messages_outbound: [{ data: { id: "msg1" }, error: null }],
    };
    rpcMock = vi.fn(async () => ({ data: null, error: null }));
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await PATCH(patchRequest({ status: "ready" }), {
      params: Promise.resolve({ id: "o1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sms_queued: true });
    expect(rpcMock).toHaveBeenCalledWith("fn_enqueue_message_outbound", { p_message_id: "msg1" });
  });

  it("never re-sends the order_ready SMS if the order is already 'ready'", async () => {
    serverQueue = {
      orders: [
        { data: { id: "o1", status: "ready", customer_id: "c1" }, error: null },
        { error: null },
      ],
    };
    serviceQueue = {};
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await PATCH(patchRequest({ status: "ready" }), {
      params: Promise.resolve({ id: "o1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sms_queued: false });
  });

  it("never sends SMS to an opted-out customer", async () => {
    serverQueue = {
      orders: [
        { data: { id: "o1", status: "preparing", customer_id: "c1" }, error: null },
        { error: null },
      ],
    };
    serviceQueue = {
      customers: [{ data: { phone_e164: "+15551234567", sms_opt_out: true }, error: null }],
    };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await PATCH(patchRequest({ status: "ready" }), {
      params: Promise.resolve({ id: "o1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sms_queued: false });
  });
});
