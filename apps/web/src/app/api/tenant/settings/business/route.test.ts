import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("POST /api/tenant/settings/business — address + delivery (DELIVERY-1)", () => {
  const base = { name: "Taco Town", timezone: "America/Chicago" };
  const restaurant = {
    timezone: "America/Chicago",
    vertical: "restaurant",
    business_street: "400 N Greenville Ave",
    business_city: "Richardson",
    business_state: "TX",
    business_zip: "75081",
  };

  function stubEdge(body: unknown, status = 200) {
    const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status });
      }),
    );
    return calls;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("normalizes and saves the address, then locates it via the edge function with the owner's own token (no body)", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", { data: { ...restaurant, business_street: null }, error: null });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    const edge = stubEdge({
      matched_address: "500 MAIN ST, RICHARDSON, TX, 75081",
      lat: 32.9,
      lng: -96.7,
    });
    const res = await POST(
      jsonRequest(url, {
        ...base,
        business_street: " 500  Main St ",
        business_city: "Richardson",
        business_state: "tx",
        business_zip: "750811234",
      }),
    );
    expect(res.status).toBe(200);
    expect(fake.callsTo("tenants", "update")[0]?.payload).toEqual({
      ...base,
      business_street: "500 Main St",
      business_city: "Richardson",
      business_state: "TX",
      business_zip: "75081-1234",
    });
    expect(edge).toHaveLength(1);
    expect(edge[0]?.url).toMatch(/\/functions\/v1\/api-tenant-business-location$/);
    expect(edge[0]?.init?.method).toBe("POST");
    expect(edge[0]?.init?.body).toBeUndefined();
    const headers = (edge[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer jwt");
    expect(await res.json()).toMatchObject({
      ok: true,
      business_location: { matched_address: "500 MAIN ST, RICHARDSON, TX, 75081" },
    });
  });

  it("restaurant: converts dollars to integer cents and miles to numbers", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", { data: restaurant, error: null });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    stubEdge({});
    const res = await POST(
      jsonRequest(url, {
        ...base,
        delivery_radius_miles: "7.5",
        delivery_fee_base: "$3",
        delivery_fee_per_mile: "1.25",
        delivery_fee_included_miles: "2",
        delivery_min_order: "15.00",
      }),
    );
    expect(res.status).toBe(200);
    expect(fake.callsTo("tenants", "update")[0]?.payload).toEqual({
      ...base,
      delivery_radius_miles: 7.5,
      delivery_fee_base_cents: 300,
      delivery_fee_per_mile_cents: 125,
      delivery_fee_included_miles: 2,
      delivery_min_order_cents: 1500,
    });
    // The address did not change: no geocode.
    expect(await res.json()).toMatchObject({ business_location: null });
  });

  it("restaurant: blank delivery fields clear them (null)", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", { data: restaurant, error: null });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    await POST(
      jsonRequest(url, {
        ...base,
        delivery_radius_miles: "",
        delivery_fee_base: "",
        delivery_min_order: null,
      }),
    );
    expect(fake.callsTo("tenants", "update")[0]?.payload).toMatchObject({
      delivery_radius_miles: null,
      delivery_fee_base_cents: null,
      delivery_min_order_cents: null,
    });
  });

  it("ignores delivery fields for a non-restaurant tenant", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", { data: { ...restaurant, vertical: "auto" }, error: null });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    await POST(jsonRequest(url, { ...base, delivery_fee_base: "3.00" }));
    expect(fake.callsTo("tenants", "update")[0]?.payload).toEqual(base);
  });

  it("422s, without writing, on a negative fee, more than 2 decimals, a 500-mile radius, or a bad state/ZIP", async () => {
    fake.signInAs(OWNER);
    for (const extra of [
      { delivery_fee_base: "-1" },
      { delivery_fee_per_mile: "1.255" },
      { delivery_radius_miles: "500" },
      { delivery_min_order: "abc" },
      { business_state: "Texas" },
      { business_zip: "7508" },
    ]) {
      const res = await POST(jsonRequest(url, { ...base, ...extra }));
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
  });

  it("an incomplete changed address is reported without calling the edge function", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", {
      data: {
        ...restaurant,
        business_street: null,
        business_city: null,
        business_state: null,
        business_zip: null,
      },
      error: null,
    });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    const edge = stubEdge({});
    const res = await POST(jsonRequest(url, { ...base, business_street: "500 Main St" }));
    expect(edge).toHaveLength(0);
    expect(await res.json()).toMatchObject({
      business_location: { error: "address_incomplete" },
    });
  });

  it("a failing or unexpected edge answer is lookup_unavailable, never a failed save", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", {
      data: { ...restaurant, business_street: "1 Old St" },
      error: null,
    });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    stubEdge({ error: "forbidden" }, 403);
    const res = await POST(jsonRequest(url, { ...base, business_street: "500 Main St" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      business_location: { error: "lookup_unavailable" },
    });
  });

  it("passes the edge function's not_found through", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:select", {
      data: { ...restaurant, business_street: "1 Old St" },
      error: null,
    });
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    stubEdge({ error: "not_found" });
    const res = await POST(jsonRequest(url, { ...base, business_street: "1 Nowhere Rd" }));
    expect(await res.json()).toMatchObject({ business_location: { error: "not_found" } });
  });
});
