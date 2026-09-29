import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, MEMBER, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});
const regenerate = vi.fn(async (_tenantId: string) => ({ resources: 2, failed: 0 }));
vi.mock("@/lib/settings/availability", () => ({
  regenerateTenantAvailability: (tenantId: string) => regenerate(tenantId),
}));

const { POST } = await import("./route");

const url = "/api/tenant/settings/business";

beforeEach(() => {
  fake.reset();
  regenerate.mockClear();
});

describe("POST /api/tenant/settings/business", () => {
  it("401s when signed out", async () => {
    const res = await POST(jsonRequest(url, { name: "Acme", timezone: "America/Chicago" }));
    expect(res.status).toBe(401);
  });

  it("403s for a member (RLS would silently drop the write)", async () => {
    fake.signInAs(MEMBER);
    const res = await POST(jsonRequest(url, { name: "Acme", timezone: "America/Chicago" }));
    expect(res.status).toBe(403);
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
  });

  it("422s on an unknown time zone", async () => {
    fake.signInAs(OWNER);
    const res = await POST(jsonRequest(url, { name: "Acme", timezone: "Mars/Base" }));
    expect(res.status).toBe(422);
  });

  it("saves name + zone scoped to the JWT tenant and regenerates slots when the zone changed", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", { data: { timezone: "America/New_York" }, error: null });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    const res = await POST(
      jsonRequest(url, {
        name: " Riverside Auto ",
        timezone: "America/Chicago",
        tenant_id: "evil",
      }),
    );
    expect(res.status).toBe(200);
    const update = fake.callsTo("tenants", "update")[0];
    expect(update?.payload).toEqual({ name: "Riverside Auto", timezone: "America/Chicago" });
    expect(update?.filters).toContainEqual(["eq", "id", "t1"]);
    expect(regenerate).toHaveBeenCalledWith("t1");
    expect(await res.json()).toMatchObject({ ok: true, timezone_changed: true });
  });

  it("does not regenerate when only the name changed", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", { data: { timezone: "America/Chicago" }, error: null });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    const res = await POST(jsonRequest(url, { name: "Renamed", timezone: "America/Chicago" }));
    expect(res.status).toBe(200);
    expect(regenerate).not.toHaveBeenCalled();
  });

  it("404s when RLS matched no row", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: [], error: null });
    const res = await POST(jsonRequest(url, { name: "Acme", timezone: "America/Chicago" }));
    expect(res.status).toBe(404);
  });
});
