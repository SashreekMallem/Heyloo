import { describe, expect, it, vi } from "vitest";
import { encodeSignupDraft, SIGNUP_DRAFT_COOKIE } from "@/lib/signup/draft-cookie";

Object.assign(process.env, { SIGNUP_DRAFT_SECRET: "test-signup-draft-secret" });

let mockSession: { access_token: string } | null = null;
let mockUser: { email: string } | null = null;
const refreshSession = vi.fn(async () => ({ data: {}, error: null }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockUser } }),
      getSession: () => Promise.resolve({ data: { session: mockSession } }),
      refreshSession,
    },
  }),
}));

let cookieValue: string | undefined;
const cookieDelete = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SIGNUP_DRAFT_COOKIE.name && cookieValue ? { value: cookieValue } : undefined,
    delete: cookieDelete,
  }),
}));

let edgeResult: { status: number; body: unknown } = {
  status: 200,
  body: { checkout_url: "https://checkout.stripe.com/session123", tenant_id: "t1" },
};
const callEdgeFunction = vi.fn(async (..._args: unknown[]) => edgeResult);

vi.mock("@/lib/edge-functions", () => ({
  callEdgeFunction: (...args: unknown[]) => callEdgeFunction(...args),
}));

const { POST } = await import("./route");

function postRequest(body: unknown = {}) {
  return new Request("http://localhost/api/checkout/session", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/checkout/session", () => {
  it("401s when there is no authenticated session", async () => {
    mockUser = null;
    mockSession = null;
    cookieValue = undefined;
    const res = await POST(postRequest());
    expect(res.status).toBe(401);
  });

  it("400s when the signed signup-draft cookie is missing", async () => {
    mockUser = { email: "owner@example.com" };
    mockSession = { access_token: "at1" };
    cookieValue = undefined;
    const res = await POST(postRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_draft" });
  });

  it("never trusts a client-supplied tenant_id — the request body carries no such field to the edge function", async () => {
    mockUser = { email: "owner@example.com" };
    mockSession = { access_token: "at1" };
    cookieValue = encodeSignupDraft({ business_type: "auto", business_name: "Joe's Garage" });
    edgeResult = { status: 200, body: { checkout_url: "https://checkout.stripe.com/s1" } };
    callEdgeFunction.mockClear();

    await POST(postRequest({ tenant_id: "attacker-supplied", timezone: "America/Chicago" }));

    expect(callEdgeFunction).toHaveBeenCalledWith(
      "api-checkout",
      expect.objectContaining({
        accessToken: "at1",
        body: {
          vertical: "auto",
          business_name: "Joe's Garage",
          email: "owner@example.com",
          timezone: "America/Chicago",
        },
      }),
    );
  });

  it("passes through the edge function's error and status on failure", async () => {
    mockUser = { email: "owner@example.com" };
    mockSession = { access_token: "at1" };
    cookieValue = encodeSignupDraft({ business_type: "vet", business_name: "Paws Clinic" });
    edgeResult = { status: 409, body: { error: "tenant_already_exists" } };

    const res = await POST(postRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "tenant_already_exists" });
  });

  it("refreshes the session, clears the draft cookie, and returns the checkout url on success", async () => {
    mockUser = { email: "owner@example.com" };
    mockSession = { access_token: "at1" };
    cookieValue = encodeSignupDraft({ business_type: "legal", business_name: "Doe & Associates" });
    edgeResult = { status: 200, body: { checkout_url: "https://checkout.stripe.com/xyz" } };
    refreshSession.mockClear();
    cookieDelete.mockClear();

    const res = await POST(postRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/xyz" });
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(cookieDelete).toHaveBeenCalledWith(SIGNUP_DRAFT_COOKIE.name);
  });
});
