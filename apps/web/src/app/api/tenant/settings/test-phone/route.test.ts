import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

const { POST } = await import("./route");

const url = "/api/tenant/settings/test-phone";

beforeEach(() => fake.reset());

describe("POST /api/tenant/settings/test-phone", () => {
  it("stores the owner's test phone as E.164 so caller-ID matching works", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    const res = await POST(jsonRequest(url, { owner_test_phone: "(610) 555-0100" }));
    expect(res.status).toBe(200);
    expect(fake.callsTo("tenants", "update")[0]?.payload).toEqual({
      owner_test_phone: "+16105550100",
    });
  });

  it("clears it when blank and 422s on a partial number", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    await POST(jsonRequest(url, { owner_test_phone: "" }));
    expect(fake.callsTo("tenants", "update")[0]?.payload).toEqual({ owner_test_phone: null });
    expect((await POST(jsonRequest(url, { owner_test_phone: "555-0100" }))).status).toBe(422);
  });

  it("401s when signed out", async () => {
    expect((await POST(jsonRequest(url, { owner_test_phone: "" }))).status).toBe(401);
  });
});
