import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, MEMBER, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

const { POST } = await import("./route");

const url = "/api/tenant/settings/reminders-review";
const validPayload = {
  voice_reminders_enabled: true,
  review_request_enabled: true,
  review_url: "https://reviews.example.com/acme",
  avg_transaction_value_cents: 12000,
};

beforeEach(() => fake.reset());

describe("POST /api/tenant/settings/reminders-review", () => {
  it("401s when unauthenticated", async () => {
    expect((await POST(jsonRequest(url, validPayload))).status).toBe(401);
  });

  it("403s when the caller has no tenant_id claim", async () => {
    fake.signInAs({});
    expect((await POST(jsonRequest(url, validPayload))).status).toBe(403);
  });

  it("QA-1 SEC-07: 403s a member and never touches the tenants row", async () => {
    fake.signInAs(MEMBER);
    const res = await POST(jsonRequest(url, validPayload));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_or_admin_required" });
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
  });

  it("QA-1 SEC-07: a write RLS filtered to zero rows is a 404, not {ok:true}", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: [], error: null });
    expect((await POST(jsonRequest(url, validPayload))).status).toBe(404);
  });

  it("422s on a payload that fails reminderReviewSettingsSchema", async () => {
    fake.signInAs(OWNER);
    const res = await POST(jsonRequest(url, { ...validPayload, avg_transaction_value_cents: -1 }));
    expect(res.status).toBe(422);
  });

  it("422s on an invalid review_url", async () => {
    fake.signInAs(OWNER);
    expect(
      (await POST(jsonRequest(url, { ...validPayload, review_url: "not-a-url" }))).status,
    ).toBe(422);
  });

  it("SETTINGS-1: 422s when review requests are on but there is no review link", async () => {
    fake.signInAs(OWNER);
    expect((await POST(jsonRequest(url, { ...validPayload, review_url: "" }))).status).toBe(422);
  });

  it("SETTINGS-1: a blank link clears review_url when review requests are off", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    const res = await POST(
      jsonRequest(url, { ...validPayload, review_request_enabled: false, review_url: "" }),
    );
    expect(res.status).toBe(200);
    expect(fake.callsTo("tenants", "update")[0]?.payload).toMatchObject({
      review_request_enabled: false,
      review_url: null,
    });
  });

  it("updates the tenants row scoped to the caller's own tenant_id", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    const res = await POST(jsonRequest(url, validPayload));
    expect(res.status).toBe(200);
    const update = fake.callsTo("tenants", "update")[0];
    expect(update?.filters).toContainEqual(["eq", "id", "t1"]);
    expect(update?.payload).toEqual({
      voice_reminders_enabled: true,
      review_request_enabled: true,
      review_url: "https://reviews.example.com/acme",
      avg_transaction_value_cents: 12000,
    });
  });

  it("500s when the update fails", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: null, error: { message: "db down" } });
    expect((await POST(jsonRequest(url, validPayload))).status).toBe(500);
  });
});
