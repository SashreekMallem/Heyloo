import { beforeEach, describe, expect, it, vi } from "vitest";

let session: { access_token: string } | null = { access_token: "jwt" };
let claims: Record<string, unknown> = { tenant_id: "t1" };
const callEdgeFunction = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: { getSession: async () => ({ data: { session } }) },
  }),
}));
vi.mock("@/lib/auth/claims", () => ({ claimsFromSupabaseClient: async () => claims }));
vi.mock("@/lib/edge-functions", () => ({
  callEdgeFunction: (...args: unknown[]) => callEdgeFunction(...args),
}));

const { POST } = await import("./route");

beforeEach(() => {
  session = { access_token: "jwt" };
  claims = { tenant_id: "t1" };
  callEdgeFunction.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/billing/portal", () => {
  it("401 without a session, 403 without a tenant", async () => {
    session = null;
    expect((await POST()).status).toBe(401);
    session = { access_token: "jwt" };
    claims = {};
    expect((await POST()).status).toBe(403);
  });

  it("returns only the portal url on success", async () => {
    callEdgeFunction.mockResolvedValue({
      status: 200,
      body: { url: "https://billing.stripe.com/p/session/x", extra: 1 },
    });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://billing.stripe.com/p/session/x" });
    expect(callEdgeFunction.mock.calls[0]?.[1]).toMatchObject({ timeoutMs: 10_000 });
  });

  it("passes owner/billing-account codes through with their status", async () => {
    callEdgeFunction.mockResolvedValue({ status: 403, body: { error: "not_tenant_owner" } });
    const res = await POST();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_tenant_owner" });
    callEdgeFunction.mockResolvedValue({ status: 409, body: { error: "no_billing_account" } });
    expect((await POST()).status).toBe(409);
  });

  it("maps a not-deployed function (gateway 404 NOT_FOUND) to 503 portal_unavailable", async () => {
    callEdgeFunction.mockResolvedValue({
      status: 404,
      body: { code: "NOT_FOUND", message: "Requested function was not found" },
    });
    const res = await POST();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "portal_unavailable" });
  });

  it("maps stripe/config failures and a 200 without a url to portal_unavailable", async () => {
    callEdgeFunction.mockResolvedValue({ status: 503, body: { error: "not_configured" } });
    expect(await (await POST()).json()).toEqual({ error: "portal_unavailable" });
    callEdgeFunction.mockResolvedValue({ status: 200, body: {} });
    expect((await POST()).status).toBe(503);
  });

  it("answers 503 (not an unhandled 500) when the function is unreachable or times out", async () => {
    callEdgeFunction.mockRejectedValue(new Error("fetch failed"));
    const res = await POST();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "portal_unavailable" });
  });
});
