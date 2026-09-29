import { beforeEach, describe, expect, it, vi } from "vitest";

let user: { id: string } | null = { id: "u1" };
let rpcResult: { data: unknown; error: unknown } = { data: true, error: null };
const rpc = vi.fn(async (..._args: unknown[]) => rpcResult);
const fromSpy = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user } }),
      getClaims: async () => ({
        data: { claims: { app_metadata: { tenant_id: "t1", role: "owner" } } },
        error: null,
      }),
    },
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => fromSpy(...args),
  }),
}));

const { POST } = await import("./route");

const CUSTOMER_ID = "0b1f2f3a-4b5c-4d6e-8f70-123456789abc";

function post(body: unknown) {
  return new Request(`http://localhost/api/tenant/customers/${CUSTOMER_ID}/notes`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  user = { id: "u1" };
  rpcResult = { data: true, error: null };
  rpc.mockClear();
  fromSpy.mockClear();
});

describe("POST /api/tenant/customers/[id]/notes (QA-1 F-05)", () => {
  it("appends through the atomic fn_append_customer_note RPC, never a read-modify-write of metadata", async () => {
    const res = await POST(post({ note: "Prefers mornings" }), {
      params: Promise.resolve({ id: CUSTOMER_ID }),
    });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("fn_append_customer_note", {
      p_customer_id: CUSTOMER_ID,
      p_body: "Prefers mornings",
    });
    // The lost-update path (select metadata -> update whole metadata) is gone.
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("404s when the RPC updated no row (unknown customer / other tenant)", async () => {
    rpcResult = { data: false, error: null };
    const res = await POST(post({ note: "x" }), { params: Promise.resolve({ id: CUSTOMER_ID }) });
    expect(res.status).toBe(404);
  });

  it("500s on an RPC error", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    const res = await POST(post({ note: "x" }), { params: Promise.resolve({ id: CUSTOMER_ID }) });
    expect(res.status).toBe(500);
  });

  it("401s when unauthenticated and 422s on an empty note", async () => {
    user = null;
    let res = await POST(post({ note: "x" }), { params: Promise.resolve({ id: CUSTOMER_ID }) });
    expect(res.status).toBe(401);
    user = { id: "u1" };
    res = await POST(post({ note: "" }), { params: Promise.resolve({ id: CUSTOMER_ID }) });
    expect(res.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
});
