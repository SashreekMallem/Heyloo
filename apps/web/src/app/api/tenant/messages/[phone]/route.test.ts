import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "limit", "maybeSingle", "insert", "update"]) {
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
let rpcMock = vi.fn(
  async (..._args: unknown[]): Promise<{ data: null; error: { message: string } | null }> => ({
    data: null,
    error: null,
  }),
);

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

const { POST } = await import("./route");

function postRequest(body: unknown) {
  return new Request("http://localhost/api/tenant/messages/%2B15551234567", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/tenant/messages/[phone]", () => {
  it("401s when unauthenticated", async () => {
    serverQueue = {};
    serviceQueue = {};
    mockGetUser = async () => ({ data: { user: null } });
    const res = await POST(postRequest({ body: "hi" }), {
      params: Promise.resolve({ phone: "+15551234567" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an empty body", async () => {
    serverQueue = {};
    serviceQueue = {};
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ body: "" }), {
      params: Promise.resolve({ phone: "+15551234567" }),
    });
    expect(res.status).toBe(422);
  });

  it("refuses to send to an opted-out customer", async () => {
    serverQueue = {};
    serviceQueue = { customers: [{ data: { sms_opt_out: true }, error: null }] };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ body: "hi" }), {
      params: Promise.resolve({ phone: "+15551234567" }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "opted_out" });
  });

  it("queues an owner_reply message for an opted-in customer and enqueues it", async () => {
    serverQueue = {};
    serviceQueue = {
      customers: [{ data: { sms_opt_out: false }, error: null }],
      messages_outbound: [
        { count: 0, data: null, error: null },
        { data: { id: "m1" }, error: null },
      ],
    };
    rpcMock = vi.fn(async (..._args: unknown[]) => ({ data: null, error: null }));
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ body: "See you at 3pm!" }), {
      params: Promise.resolve({ phone: "+15551234567" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message_id: "m1" });
    expect(rpcMock).toHaveBeenCalledWith("fn_enqueue_message_outbound", {
      p_message_id: "m1",
    });
  });

  it("fails the request (502) and marks the row failed when the enqueue RPC errors (QA-1 F-11)", async () => {
    serverQueue = {};
    serviceQueue = {
      customers: [{ data: { sms_opt_out: false }, error: null }],
      messages_outbound: [
        { count: 0, data: null, error: null },
        { data: { id: "m-enq" }, error: null },
        { data: null, error: null },
      ],
    };
    rpcMock = vi.fn(async (..._args: unknown[]) => ({
      data: null,
      error: { message: "pgmq down" },
    }));
    mockGetUser = async () => ({ data: { user: mockUser } });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(postRequest({ body: "hi" }), {
      params: Promise.resolve({ phone: "+15551234567" }),
    });
    errSpy.mockRestore();
    rpcMock = vi.fn(async (..._args: unknown[]) => ({ data: null, error: null }));
    expect(res.status).toBe(502);
    // the follow-up status update consumed the third queued result
    expect(serviceQueue["messages_outbound"]).toHaveLength(0);
  });

  it("rejects a non-E.164 path segment with 422 and never inserts it as the recipient (QA-1 SEC-10 / F-22)", async () => {
    serverQueue = {};
    serviceQueue = { messages_outbound: [{ data: { id: "m-bad" }, error: null }] };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ body: "hi" }), {
      params: Promise.resolve({ phone: "abc" }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "invalid_phone" });
    // The queued outbound row was never consumed => nothing was inserted.
    expect(serviceQueue["messages_outbound"]).toHaveLength(1);
  });

  it("decodes a percent-encoded '+' and stores the E.164 recipient", async () => {
    serverQueue = {};
    serviceQueue = {
      customers: [{ data: { sms_opt_out: false }, error: null }],
      messages_outbound: [
        { count: 0, data: null, error: null },
        { data: { id: "m2" }, error: null },
      ],
    };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ body: "hi" }), {
      params: Promise.resolve({ phone: "%2B15551234567" }),
    });
    expect(res.status).toBe(200);
  });

  it("404s for a number that is not a customer or an existing thread of the tenant (QA-1 SEC-10)", async () => {
    serverQueue = {};
    serviceQueue = {
      customers: [{ data: null, error: null }],
      text_conversations: [{ data: null, error: null }],
      messages_inbound: [{ data: null, error: null }],
      messages_outbound: [{ data: { id: "never" }, error: null }],
    };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ body: "hi" }), {
      params: Promise.resolve({ phone: "+15559998888" }),
    });
    expect(res.status).toBe(404);
    expect(serviceQueue["messages_outbound"]).toHaveLength(1);
  });

  it("allows a number with an existing conversation even without a customers row", async () => {
    serverQueue = {};
    serviceQueue = {
      customers: [{ data: null, error: null }],
      text_conversations: [{ data: { id: "c1" }, error: null }],
      messages_inbound: [{ data: null, error: null }],
      messages_outbound: [
        { count: 0, data: null, error: null },
        { data: { id: "m3" }, error: null },
      ],
    };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ body: "hi" }), {
      params: Promise.resolve({ phone: "+15559998888" }),
    });
    expect(res.status).toBe(200);
  });

  it("429s once the tenant's owner_reply sliding window is full (QA-1 SEC-10)", async () => {
    serverQueue = {};
    serviceQueue = {
      customers: [{ data: { sms_opt_out: false }, error: null }],
      messages_outbound: [
        { count: 30, data: null, error: null },
        { data: { id: "never" }, error: null },
      ],
    };
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await POST(postRequest({ body: "hi" }), {
      params: Promise.resolve({ phone: "+15551234567" }),
    });
    expect(res.status).toBe(429);
    expect(serviceQueue["messages_outbound"]).toHaveLength(1);
  });
});
