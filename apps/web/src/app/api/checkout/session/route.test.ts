import { describe, expect, it, vi } from "vitest";
import { REFERRAL_COOKIE } from "@/app/api/partner/_lib/referral-cookie";
import { encodeSignupDraft, SIGNUP_DRAFT_COOKIE } from "@/lib/signup/draft-cookie";

Object.assign(process.env, { SIGNUP_DRAFT_SECRET: "test-signup-draft-secret" });

let mockSession: { access_token: string } | null = null;
let mockUser: { email: string; user_metadata?: unknown } | null = null;
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
let refCookieValue: string | undefined;
const cookieDelete = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === SIGNUP_DRAFT_COOKIE.name && cookieValue) return { value: cookieValue };
      if (name === REFERRAL_COOKIE.name && refCookieValue) return { value: refCookieValue };
      return undefined;
    },
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

  it("forwards white_glove: true to the edge function when the tenant opted in on the plan step", async () => {
    mockUser = { email: "owner@example.com" };
    mockSession = { access_token: "at1" };
    cookieValue = encodeSignupDraft({ business_type: "auto", business_name: "Joe's Garage" });
    edgeResult = { status: 200, body: { checkout_url: "https://checkout.stripe.com/s2" } };
    callEdgeFunction.mockClear();

    await POST(postRequest({ white_glove: true, timezone: "America/Chicago" }));

    expect(callEdgeFunction).toHaveBeenCalledWith(
      "api-checkout",
      expect.objectContaining({
        accessToken: "at1",
        body: {
          vertical: "auto",
          business_name: "Joe's Garage",
          email: "owner@example.com",
          timezone: "America/Chicago",
          white_glove: true,
        },
      }),
    );
  });

  it("forwards the draft's business phone and website, never a body-supplied one", async () => {
    mockUser = { email: "owner@example.com" };
    mockSession = { access_token: "at1" };
    cookieValue = encodeSignupDraft({
      business_type: "auto",
      business_name: "Joe's Garage",
      business_phone: "+12627551967",
      website_url: "https://joesgarage.com",
    });
    edgeResult = { status: 200, body: { checkout_url: "https://checkout.stripe.com/s5" } };
    callEdgeFunction.mockClear();

    await POST(postRequest({ business_phone: "+19995550000", website_url: "https://evil.test" }));

    expect(callEdgeFunction).toHaveBeenCalledWith(
      "api-checkout",
      expect.objectContaining({
        body: {
          vertical: "auto",
          business_name: "Joe's Garage",
          business_phone: "+12627551967",
          website_url: "https://joesgarage.com",
          email: "owner@example.com",
        },
      }),
    );
  });

  it("PT-01: forwards the referral cookie's code to api-checkout, ignoring a body-supplied one", async () => {
    mockUser = { email: "owner@example.com" };
    mockSession = { access_token: "at1" };
    cookieValue = encodeSignupDraft({ business_type: "auto", business_name: "Joe's Garage" });
    refCookieValue = "abcd2345";
    edgeResult = { status: 200, body: { checkout_url: "https://checkout.stripe.com/s3" } };
    callEdgeFunction.mockClear();

    await POST(postRequest({ referral_code: "ATTACKER1" }));

    expect(callEdgeFunction).toHaveBeenCalledWith(
      "api-checkout",
      expect.objectContaining({
        body: {
          vertical: "auto",
          business_name: "Joe's Garage",
          email: "owner@example.com",
          referral_code: "ABCD2345",
        },
      }),
    );
    refCookieValue = undefined;
  });

  it("PT-01: drops a malformed referral cookie", async () => {
    mockUser = { email: "owner@example.com" };
    mockSession = { access_token: "at1" };
    cookieValue = encodeSignupDraft({ business_type: "auto", business_name: "Joe's Garage" });
    refCookieValue = "no good!";
    edgeResult = { status: 200, body: { checkout_url: "https://checkout.stripe.com/s4" } };
    callEdgeFunction.mockClear();

    await POST(postRequest());

    const call = callEdgeFunction.mock.calls[0] as unknown as [string, { body: object }];
    expect("referral_code" in call[1].body).toBe(false);
    refCookieValue = undefined;
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

  it("refreshes the session, KEEPS the draft cookie (cancel at Stripe returns to /signup/plan), and returns the checkout url on success", async () => {
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
    expect(cookieDelete).not.toHaveBeenCalled();
  });

  it("falls back to the draft saved on the user at signUp when the cookie is gone (email confirmed in another browser)", async () => {
    mockUser = {
      email: "owner@example.com",
      user_metadata: {
        owner_name: "Joe",
        signup_draft: { business_type: "dental", business_name: "Bright Smiles" },
        signup_plan: { annual: false, white_glove: true },
      },
    };
    mockSession = { access_token: "at1" };
    cookieValue = undefined;
    edgeResult = { status: 200, body: { checkout_url: "https://checkout.stripe.com/s3" } };
    callEdgeFunction.mockClear();

    const res = await POST(postRequest({ white_glove: true }));
    expect(res.status).toBe(200);
    expect(callEdgeFunction).toHaveBeenCalledWith(
      "api-checkout",
      expect.objectContaining({
        body: {
          vertical: "dental",
          business_name: "Bright Smiles",
          email: "owner@example.com",
          white_glove: true,
        },
      }),
    );
  });

  it("still 400s when neither the cookie nor a valid user-metadata draft exists (a tampered draft is not trusted)", async () => {
    mockUser = {
      email: "owner@example.com",
      user_metadata: { signup_draft: { business_type: "not-a-vertical", business_name: "x" } },
    };
    mockSession = { access_token: "at1" };
    cookieValue = undefined;
    const res = await POST(postRequest());
    expect(res.status).toBe(400);
  });
});
