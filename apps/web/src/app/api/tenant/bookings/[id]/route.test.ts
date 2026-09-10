import { describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "maybeSingle", "update", "insert"]) {
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
    auth: { getUser: () => mockGetUser() },
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
  return new Request("http://localhost/api/tenant/bookings/b1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/tenant/bookings/[id]", () => {
  it("401s when unauthenticated", async () => {
    serverQueue = {};
    serviceQueue = {};
    mockGetUser = async () => ({ data: { user: null } });
    const res = await PATCH(patchRequest({ action: "confirm" }), {
      params: Promise.resolve({ id: "b1" }),
    });
    expect(res.status).toBe(401);
  });

  it("403s when the caller has no tenant_id claim", async () => {
    serverQueue = {};
    serviceQueue = {};
    mockGetUser = async () => ({ data: { user: { id: "u1", app_metadata: {} } } });
    const res = await PATCH(patchRequest({ action: "confirm" }), {
      params: Promise.resolve({ id: "b1" }),
    });
    expect(res.status).toBe(403);
  });

  it("404s when the booking doesn't belong to the caller's tenant", async () => {
    serverQueue = { bookings: [{ data: null, error: null }] };
    serviceQueue = {};
    mockGetUser = async () => ({ data: { user: mockUser } });
    const res = await PATCH(patchRequest({ action: "confirm" }), {
      params: Promise.resolve({ id: "b1" }),
    });
    expect(res.status).toBe(404);
  });

  it("reschedules against a real availability_slots row and notifies the customer", async () => {
    serverQueue = {
      bookings: [
        {
          data: { id: "b1", customer_id: "c1", resource_id: "r1", status: "scheduled" },
          error: null,
        },
        { error: null },
      ],
      tenants: [{ data: { timezone: "America/New_York" }, error: null }],
      availability_slots: [
        {
          data: {
            id: "s1",
            slot_range: '["2026-09-08 09:00:00+00","2026-09-08 09:30:00+00")',
            resource_id: "r1",
            is_available: true,
          },
          error: null,
        },
      ],
    };
    serviceQueue = {
      customers: [{ data: { phone_e164: "+15551234567", sms_opt_out: false }, error: null }],
      messages_outbound: [{ data: { id: "msg1" }, error: null }],
    };
    rpcMock = vi.fn(async (..._args: unknown[]) => ({ data: null, error: null }));
    mockGetUser = async () => ({ data: { user: mockUser } });

    const res = await PATCH(patchRequest({ action: "reschedule", new_slot_id: "s1" }), {
      params: Promise.resolve({ id: "b1" }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, sms_queued: true });
    expect(rpcMock).toHaveBeenCalledWith("fn_enqueue_message_outbound", {
      p_message_id: "msg1",
    });
  });

  it("returns a 409 slot_taken when the exclusion constraint rejects the reschedule", async () => {
    serverQueue = {
      bookings: [
        {
          data: { id: "b1", customer_id: "c1", resource_id: "r1", status: "scheduled" },
          error: null,
        },
        { error: { code: "23P01" } },
      ],
      tenants: [{ data: { timezone: "America/New_York" }, error: null }],
      availability_slots: [
        {
          data: {
            id: "s1",
            slot_range: '["2026-09-08 09:00:00+00","2026-09-08 09:30:00+00")',
            resource_id: "r1",
            is_available: true,
          },
          error: null,
        },
      ],
    };
    serviceQueue = {};
    mockGetUser = async () => ({ data: { user: mockUser } });

    const res = await PATCH(patchRequest({ action: "reschedule", new_slot_id: "s1" }), {
      params: Promise.resolve({ id: "b1" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ confirmed: false, reason: "slot_taken" });
  });
});
