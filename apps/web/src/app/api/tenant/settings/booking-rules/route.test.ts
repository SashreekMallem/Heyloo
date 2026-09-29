import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, MEMBER, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

const { GET, POST } = await import("./route");

const url = "/api/tenant/settings/booking-rules";

beforeEach(() => fake.reset());

describe("GET /api/tenant/settings/booking-rules", () => {
  it("reports available:false while the migration is not applied (undefined column)", async () => {
    fake.signInAs(MEMBER);
    fake.queue("tenants:select", { data: null, error: { code: "42703", message: "no column" } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      available: false,
      min_notice_minutes: null,
      horizon_days: null,
    });
  });

  it("returns the stored rules", async () => {
    fake.signInAs(MEMBER);
    fake.queue("tenants:select", {
      data: { booking_min_notice_minutes: 120, booking_horizon_days: null },
      error: null,
    });
    expect(await (await GET()).json()).toEqual({
      available: true,
      min_notice_minutes: 120,
      horizon_days: null,
    });
  });
});

describe("POST /api/tenant/settings/booking-rules", () => {
  it("validates and writes both columns for the JWT tenant", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
    const res = await POST(jsonRequest(url, { min_notice_minutes: 60, horizon_days: 45 }));
    expect(res.status).toBe(200);
    const update = fake.callsTo("tenants", "update")[0];
    expect(update?.payload).toEqual({ booking_min_notice_minutes: 60, booking_horizon_days: 45 });
    expect(update?.filters).toContainEqual(["eq", "id", "t1"]);
  });

  it("422s out of range, 503s before the migration is applied", async () => {
    fake.signInAs(OWNER);
    expect(
      (await POST(jsonRequest(url, { min_notice_minutes: 60, horizon_days: 900 }))).status,
    ).toBe(422);
    fake.queue("tenants:update", { data: null, error: { code: "PGRST204", message: "cache" } });
    const res = await POST(jsonRequest(url, { min_notice_minutes: 60, horizon_days: 45 }));
    expect(res.status).toBe(503);
  });

  it("403s for a member", async () => {
    fake.signInAs(MEMBER);
    expect(
      (await POST(jsonRequest(url, { min_notice_minutes: null, horizon_days: null }))).status,
    ).toBe(403);
  });
});
