import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

let edgeResult: { status: number; body: unknown } | Error = { status: 200, body: {} };
const callEdgeFunction = vi.fn(async (..._args: unknown[]) => {
  if (edgeResult instanceof Error) throw edgeResult;
  return edgeResult;
});
vi.mock("@/lib/edge-functions", () => ({
  callEdgeFunction: (...args: unknown[]) => callEdgeFunction(...args),
}));

const { POST } = await import("./route");

const url = "/api/phone/forwarding-test";

beforeEach(() => {
  fake.reset();
  callEdgeFunction.mockClear();
  edgeResult = { status: 200, body: {} };
});

function edgeCall() {
  return callEdgeFunction.mock.calls[0] as unknown as [
    string,
    { accessToken: string; body: Record<string, unknown> },
  ];
}

describe("POST /api/phone/forwarding-test", () => {
  it("401s signed out and 403s for another tenant's id (never reaches the edge function)", async () => {
    expect((await POST(jsonRequest(url, { tenant_id: "t1", action: "start" }))).status).toBe(401);
    fake.signInAs(OWNER);
    expect((await POST(jsonRequest(url, { tenant_id: "t2", action: "start" }))).status).toBe(403);
    expect((await POST(jsonRequest(url, { action: "start" }))).status).toBe(403);
    expect(callEdgeFunction).not.toHaveBeenCalled();
  });

  it("422s on a missing or unknown action", async () => {
    fake.signInAs(OWNER);
    expect((await POST(jsonRequest(url, { tenant_id: "t1" }))).status).toBe(422);
    expect((await POST(jsonRequest(url, { tenant_id: "t1", action: "call" }))).status).toBe(422);
    expect(callEdgeFunction).not.toHaveBeenCalled();
  });

  it("start: forwards only the contract fields with the caller's token, and passes the result through", async () => {
    fake.signInAs(OWNER);
    edgeResult = {
      status: 200,
      body: { started: true, calling: "+12627551967", expires_at: "2026-09-30T16:00:00Z" },
    };
    const res = await POST(
      jsonRequest(url, {
        tenant_id: "t1",
        action: "start",
        carrier_hint: "verizon",
        business_phone: "+19995550000",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      started: true,
      calling: "+12627551967",
      expires_at: "2026-09-30T16:00:00Z",
    });
    const [name, init] = edgeCall();
    expect(name).toBe("forwarding-verify");
    expect(init.accessToken).toBe("jwt");
    expect(init.body).toEqual({ tenant_id: "t1", action: "start", carrier_hint: "verizon" });
  });

  it("status: never sends a carrier hint, and drops an unknown one on start", async () => {
    fake.signInAs(OWNER);
    edgeResult = { status: 200, body: { state: "pending" } };
    await POST(jsonRequest(url, { tenant_id: "t1", action: "status", carrier_hint: "att" }));
    expect(edgeCall()[1].body).toEqual({ tenant_id: "t1", action: "status" });
    callEdgeFunction.mockClear();
    await POST(jsonRequest(url, { tenant_id: "t1", action: "start", carrier_hint: "sprint" }));
    expect(edgeCall()[1].body).toEqual({ tenant_id: "t1", action: "start" });
  });

  it.each([
    [422, { error: "business_phone_missing" }],
    [429, { error: "test_in_progress", retry_after_s: 40 }],
    [404, { error: "no_test_running" }],
    [200, { state: "failed", reason: "answered" }],
  ])("passes the edge function's %i response through unchanged", async (status, body) => {
    fake.signInAs(OWNER);
    edgeResult = { status, body };
    const res = await POST(jsonRequest(url, { tenant_id: "t1", action: "status" }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });

  it("502s when the edge function is unreachable or times out", async () => {
    fake.signInAs(OWNER);
    edgeResult = new Error("aborted");
    const res = await POST(jsonRequest(url, { tenant_id: "t1", action: "start" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "forwarding_verify_unreachable" });
  });
});
