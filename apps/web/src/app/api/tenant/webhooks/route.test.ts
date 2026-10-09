import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, MEMBER, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

const callEdgeFunction = vi.fn();
vi.mock("@/lib/edge-functions", () => ({
  callEdgeFunction: (...args: unknown[]) => callEdgeFunction(...args),
}));

const { GET, POST } = await import("./route");

const url = "/api/tenant/webhooks";
const DEST_ID = "6f1c1f6e-2f4b-4f5e-9a51-0d6c1a2b3c4d";
const DELIVERY_ID = "0b9f7a8e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";

beforeEach(() => {
  fake.reset();
  callEdgeFunction.mockReset();
});

describe("POST /api/tenant/webhooks (OUTBOUND-1)", () => {
  it("401s when signed out, without calling the edge function", async () => {
    const res = await POST(jsonRequest(url, { action: "delete", id: DEST_ID }));
    expect(res.status).toBe(401);
    expect(callEdgeFunction).not.toHaveBeenCalled();
  });

  it("403s a member: only an owner or admin manages webhooks", async () => {
    fake.signInAs(MEMBER);
    const res = await POST(jsonRequest(url, { action: "delete", id: DEST_ID }));
    expect(res.status).toBe(403);
    expect(callEdgeFunction).not.toHaveBeenCalled();
  });

  it.each([
    {
      who: "a platform admin whose own tenant role is member",
      claims: { ...MEMBER, platform_admin: true },
      error: "owner_or_admin_required",
    },
    {
      who: "a read-only impersonated owner session",
      claims: { ...OWNER, impersonated_by: "admin-1", impersonation_edit_enabled: false },
      error: "read_only_session",
    },
  ])("403s $who the same way api-tenant-webhooks would", async ({ claims, error }) => {
    fake.signInAs(claims);
    const res = await POST(jsonRequest(url, { action: "delete", id: DEST_ID }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error });
    expect(callEdgeFunction).not.toHaveBeenCalled();
  });

  it("forwards an impersonated session that has edit mode on", async () => {
    fake.signInAs({ ...OWNER, impersonated_by: "admin-1", impersonation_edit_enabled: true });
    callEdgeFunction.mockResolvedValue({ status: 200, body: { ok: true } });
    const res = await POST(jsonRequest(url, { action: "delete", id: DEST_ID }));
    expect(res.status).toBe(200);
    expect(callEdgeFunction).toHaveBeenCalledOnce();
  });

  it.each([
    { action: "create", name: "Zapier", url: "http://hooks.zapier.com/x" },
    { action: "create", name: "", url: "https://hooks.zapier.com/x" },
    { action: "create", name: "Zapier", url: "https://hooks.zapier.com/x", event_types: [] },
    { action: "create", name: "Zapier", url: "https://x.example", event_types: ["call.ended"] },
    {
      action: "create",
      name: "Zapier",
      url: "https://x.example",
      event_types: ["order.created", "order.created"],
    },
    { action: "update", id: "not-a-uuid", enabled: false },
    { action: "retry", id: DEST_ID },
    { action: "drop_table" },
  ])("422s a malformed action %o", async (payload) => {
    fake.signInAs(OWNER);
    const res = await POST(jsonRequest(url, payload));
    expect(res.status).toBe(422);
    expect(callEdgeFunction).not.toHaveBeenCalled();
  });

  it("forwards a create with the caller's token, strips any body tenant_id, and never caches the secret", async () => {
    fake.signInAs(OWNER);
    callEdgeFunction.mockResolvedValue({
      status: 200,
      body: {
        destination: { id: DEST_ID, name: "Zapier", url: "https://hooks.zapier.com/x" },
        signing_secret: "whsec_abc",
      },
    });
    const res = await POST(
      jsonRequest(url, {
        action: "create",
        name: " Zapier ",
        url: "https://hooks.zapier.com/x",
        event_types: ["order.created"],
        tenant_id: "evil",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ signing_secret: "whsec_abc" });
    expect(callEdgeFunction).toHaveBeenCalledWith("api-tenant-webhooks", {
      method: "POST",
      accessToken: "jwt",
      body: {
        action: "create",
        name: "Zapier",
        url: "https://hooks.zapier.com/x",
        event_types: ["order.created"],
      },
      timeoutMs: 20_000,
    });
  });

  it("forwards send_test and retry as-is", async () => {
    fake.signInAs(OWNER);
    callEdgeFunction.mockResolvedValue({
      status: 200,
      body: { ok: false, status_code: 500, error: "HTTP 500" },
    });
    const test = await POST(jsonRequest(url, { action: "send_test", id: DEST_ID }));
    expect(await test.json()).toEqual({ ok: false, status_code: 500, error: "HTTP 500" });
    callEdgeFunction.mockResolvedValue({ status: 200, body: { ok: true } });
    await POST(jsonRequest(url, { action: "retry", delivery_id: DELIVERY_ID }));
    expect(callEdgeFunction.mock.calls.map((c) => (c[1] as { body: unknown }).body)).toEqual([
      { action: "send_test", id: DEST_ID },
      { action: "retry", delivery_id: DELIVERY_ID },
    ]);
  });

  it("passes the edge function's error status and code through", async () => {
    fake.signInAs(OWNER);
    callEdgeFunction.mockResolvedValue({ status: 409, body: { error: "destination_limit" } });
    const res = await POST(
      jsonRequest(url, { action: "create", name: "Make", url: "https://hook.make.com/x" }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "destination_limit" });
  });

  it("names an error the edge function did not explain", async () => {
    fake.signInAs(OWNER);
    callEdgeFunction.mockResolvedValue({ status: 500, body: {} });
    const res = await POST(jsonRequest(url, { action: "delete", id: DEST_ID }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "webhooks_failed" });
  });

  it("503s when the edge function is unreachable or times out", async () => {
    fake.signInAs(OWNER);
    callEdgeFunction.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const res = await POST(jsonRequest(url, { action: "send_test", id: DEST_ID }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "webhooks_unavailable" });
  });
});

describe("GET /api/tenant/webhooks (who may manage webhooks)", () => {
  it("401s when signed out", async () => {
    expect((await GET()).status).toBe(401);
  });

  it.each([
    { who: "an owner", claims: OWNER, can_manage: true, reason: null },
    { who: "an admin", claims: { tenant_id: "t1", role: "admin" }, can_manage: true, reason: null },
    { who: "a member", claims: MEMBER, can_manage: false, reason: "owner_or_admin_required" },
    {
      who: "a platform admin with a member role",
      claims: { ...MEMBER, platform_admin: true },
      can_manage: false,
      reason: "owner_or_admin_required",
    },
    {
      who: "a read-only impersonated session",
      claims: { ...OWNER, impersonated_by: "admin-1" },
      can_manage: false,
      reason: "read_only_session",
    },
    {
      who: "an impersonated session with edit mode on",
      claims: { ...OWNER, impersonated_by: "admin-1", impersonation_edit_enabled: true },
      can_manage: true,
      reason: null,
    },
  ])("answers for $who", async ({ claims, can_manage, reason }) => {
    fake.signInAs(claims);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ can_manage, reason });
    expect(callEdgeFunction).not.toHaveBeenCalled();
  });
});
