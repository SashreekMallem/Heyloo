import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/service-role", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServiceRoleServerClient: () => fakeClient() };
});

const {
  clearFutureResourceAvailability,
  regenerateResourceAvailability,
  regenerateTenantAvailability,
} = await import("./availability");

beforeEach(() => {
  fake.reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("regenerateTenantAvailability", () => {
  it("regenerates every ACTIVE resource of that tenant only", async () => {
    fake.queue("resources:select", {
      data: [{ id: "r1" }, { id: "r2" }, { id: "r3" }, { id: "r4" }, { id: "r5" }],
      error: null,
    });
    fake.queue("rpc:fn_regenerate_availability_slots", { error: null }, { error: { m: 1 } });
    const result = await regenerateTenantAvailability("t1");
    expect(result).toEqual({ resources: 5, failed: 1 });
    const read = fake.callsTo("resources")[0];
    expect(read?.filters).toEqual([
      ["eq", "tenant_id", "t1"],
      ["eq", "active", true],
    ]);
    expect(fake.rpcCalls.map((c) => c.args)).toEqual(
      ["r1", "r2", "r3", "r4", "r5"].map((id) => ({
        p_tenant_id: "t1",
        p_resource_id: id,
        p_days_ahead: null,
      })),
    );
  });

  it("reports a failure (never throws) when the resource read errors", async () => {
    fake.queue("resources:select", { data: null, error: { message: "down" } });
    expect(await regenerateTenantAvailability("t1")).toEqual({ resources: 0, failed: 1 });
  });
});

describe("regenerateResourceAvailability", () => {
  it("returns false when the RPC errors", async () => {
    fake.queue("rpc:fn_regenerate_availability_slots", { error: { message: "boom" } });
    expect(await regenerateResourceAvailability("t1", "r1")).toBe(false);
  });
});

describe("clearFutureResourceAvailability", () => {
  it("deletes only that resource's FUTURE GENERATED slots", async () => {
    const now = new Date("2026-09-29T12:00:00Z");
    expect(await clearFutureResourceAvailability("t1", "r9", now)).toBe(true);
    const call = fake.callsTo("availability_slots", "delete")[0];
    expect(call?.filters).toEqual([
      ["eq", "tenant_id", "t1"],
      ["eq", "resource_id", "r9"],
      ["eq", "source", "generated"],
      ["rangeGte", "slot_range", "[2026-09-29T12:00:00.000Z,)"],
    ]);
  });
});
