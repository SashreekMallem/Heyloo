import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, MEMBER, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

const { POST } = await import("./route");

const url = "/api/tenant/settings/business-phone";

beforeEach(() => fake.reset());

describe("POST /api/tenant/settings/business-phone", () => {
  it("401s signed out, 403s for a member", async () => {
    expect((await POST(jsonRequest(url, { business_phone: "262-755-1967" }))).status).toBe(401);
    fake.signInAs(MEMBER);
    expect((await POST(jsonRequest(url, { business_phone: "262-755-1967" }))).status).toBe(403);
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
  });

  it("422s on a blank, invalid or non-US/Canada number", async () => {
    fake.signInAs(OWNER);
    for (const business_phone of ["", "755-1967", "+44 20 7946 0958"]) {
      expect((await POST(jsonRequest(url, { business_phone }))).status).toBe(422);
    }
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
  });

  it("saves the E.164 number on the JWT tenant and fills/follows the default transfer number", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", { data: { business_phone: null }, error: null });
    fake.queue("phone_numbers:select", { data: [{ e164: "+14145550199" }], error: null });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    fake.queue("agent_configs:update", { data: [{ id: "ac1" }], error: null });
    const res = await POST(
      jsonRequest(url, { business_phone: "(262) 755-1967", tenant_id: "someone-else" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      business_phone: "+12627551967",
      transfer_number_updated: true,
    });
    const update = fake.callsTo("tenants", "update")[0];
    expect(update?.payload).toEqual({ business_phone: "+12627551967" });
    expect(update?.filters).toContainEqual(["eq", "id", "t1"]);
    // No previous business phone: only the NULL fill runs.
    const syncs = fake.callsTo("agent_configs", "update");
    expect(syncs).toHaveLength(1);
    expect(syncs[0]?.filters).toContainEqual(["is", "transfer_number", null]);
  });

  it("422s (no write) when the number is the tenant's own Heyloo number", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", { data: { business_phone: null }, error: null });
    fake.queue("phone_numbers:select", { data: [{ e164: "+12627551967" }], error: null });
    const res = await POST(jsonRequest(url, { business_phone: "262-755-1967" }));
    expect(res.status).toBe(422);
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
  });

  it("404s when RLS matched no tenant row", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: [], error: null });
    const res = await POST(jsonRequest(url, { business_phone: "262-755-1967" }));
    expect(res.status).toBe(404);
    expect(fake.callsTo("agent_configs")).toHaveLength(0);
  });
});
