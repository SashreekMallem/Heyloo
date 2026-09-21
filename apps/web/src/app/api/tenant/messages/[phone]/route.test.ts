import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle", "insert"]) {
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
      messages_outbound: [{ data: { id: "m1" }, error: null }],
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
});
