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

  it("normalizes and saves the business phone + website, and moves a default transfer number along", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", {
      data: { timezone: "America/Chicago", business_phone: "+12627551967" },
      error: null,
    });
    fake.queue("phone_numbers:select", { data: [{ e164: "+15551230000" }], error: null });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    fake.queue("agent_configs:update", { data: [], error: null }, { data: [{ id: "ac1" }] });
    const res = await POST(
      jsonRequest(url, {
        name: "Acme",
        timezone: "America/Chicago",
        business_phone: "(414) 555-0100",
        website_url: "acme.com",
      }),
    );
    expect(res.status).toBe(200);
    expect(fake.callsTo("tenants", "update")[0]?.payload).toEqual({
      name: "Acme",
      timezone: "America/Chicago",
      business_phone: "+14145550100",
      website_url: "https://acme.com",
    });
    const [fillNull, follow] = fake.callsTo("agent_configs", "update");
    expect(fillNull?.filters).toContainEqual(["is", "transfer_number", null]);
    expect(follow?.filters).toContainEqual(["eq", "transfer_number", "+12627551967"]);
    expect(follow?.filters).toContainEqual(["eq", "tenant_id", "t1"]);
    expect(await res.json()).toMatchObject({ ok: true, transfer_number_updated: true });
  });

  it("blank phone / website clear them (null) without touching the transfer number", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", {
      data: { timezone: "America/Chicago", business_phone: "+12627551967" },
      error: null,
    });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    const res = await POST(
      jsonRequest(url, {
        name: "Acme",
        timezone: "America/Chicago",
        business_phone: "",
        website_url: "",
      }),
    );
    expect(res.status).toBe(200);
    expect(fake.callsTo("tenants", "update")[0]?.payload).toMatchObject({
      business_phone: null,
      website_url: null,
    });
    expect(fake.callsTo("agent_configs")).toHaveLength(0);
  });

  it("422s on an invalid business phone or website, without writing", async () => {
    fake.signInAs(OWNER);
    for (const extra of [{ business_phone: "555-0100" }, { website_url: "ftp://acme.com" }]) {
      const res = await POST(
        jsonRequest(url, { name: "Acme", timezone: "America/Chicago", ...extra }),
      );
      expect(res.status).toBe(422);
    }
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
  });

  it("422s when the business phone is the tenant's own Heyloo number", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", { data: { timezone: "America/Chicago" }, error: null });
    fake.queue("phone_numbers:select", { data: [{ e164: "+14145550199" }], error: null });
    const res = await POST(
      jsonRequest(url, {
        name: "Acme",
        timezone: "America/Chicago",
        business_phone: "(414) 555-0199",
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: Array<{ path: string[] }> };
    expect(body.issues[0]?.path).toEqual(["business_phone"]);
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
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

  it("SETTINGS-1 review: asks Postgres whether a NEW zone is known before storing it", async () => {
    fake.signInAs(OWNER);
    fake.queue(
      "tenants:select",
      { data: { timezone: "America/New_York" }, error: null },
      { data: [], error: null },
    );
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    const res = await POST(jsonRequest(url, { name: "Acme", timezone: "America/Chicago" }));
    expect(res.status).toBe(200);
    const probe = fake.callsTo("tenants", "select")[1];
    expect(probe?.filters).toContainEqual(["eq", "id", "t1"]);
    expect(probe?.filters).toContainEqual([
      "lte",
      "created_at",
      "2999-12-31 00:00:00 America/Chicago",
    ]);
  });

  it("SETTINGS-1 review: 422s, without writing, on a zone Node knows but Postgres doesn't (would abort the nightly roll-forward for every tenant)", async () => {
    fake.signInAs(OWNER);
    fake.queue(
      "tenants:select",
      { data: { timezone: "America/New_York" }, error: null },
      {
        data: null,
        error: { code: "22023", message: 'time zone "america/coyhaique" not recognized' },
      },
    );
    const res = await POST(jsonRequest(url, { name: "Acme", timezone: "America/Santiago" }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: Array<{ path: string[]; message: string }> };
    expect(body.issues[0]?.path).toEqual(["timezone"]);
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
    expect(regenerate).not.toHaveBeenCalled();
  });

  it("SETTINGS-1 review: 500s (not 422) when the zone probe itself fails", async () => {
    fake.signInAs(OWNER);
    fake.queue(
      "tenants:select",
      { data: { timezone: "America/New_York" }, error: null },
      { data: null, error: { code: "PGRST301", message: "JWT expired" } },
    );
    const res = await POST(jsonRequest(url, { name: "Acme", timezone: "America/Chicago" }));
    expect(res.status).toBe(500);
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
  });

  it("SETTINGS-1 review: a name-only save doesn't probe the (unchanged) zone", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", { data: { timezone: "America/Chicago" }, error: null });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    await POST(jsonRequest(url, { name: "Renamed", timezone: "America/Chicago" }));
    expect(fake.callsTo("tenants", "select")).toHaveLength(1);
  });
});
