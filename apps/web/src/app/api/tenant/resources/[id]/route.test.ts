import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, MEMBER, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

// SETTINGS-1: PATCH/DELETE apply the change to availability_slots
// immediately (service-role helpers, mocked here).
const mockRegenerate = vi.fn(async (_tenantId: string, _resourceId: string) => true);
const mockClear = vi.fn(async (_tenantId: string, _resourceId: string) => true);
vi.mock("@/lib/settings/availability", () => ({
  regenerateResourceAvailability: (tenantId: string, resourceId: string) =>
    mockRegenerate(tenantId, resourceId),
  clearFutureResourceAvailability: (tenantId: string, resourceId: string) =>
    mockClear(tenantId, resourceId),
}));

const { PATCH, DELETE } = await import("./route");

const params = { params: Promise.resolve({ id: "r1" }) };
const patchRequest = (body: unknown) => jsonRequest("/api/tenant/resources/r1", body, "PATCH");
const deleteRequest = () =>
  new Request("http://localhost/api/tenant/resources/r1", { method: "DELETE" });

beforeEach(() => {
  fake.reset();
  mockRegenerate.mockClear();
  mockRegenerate.mockImplementation(async () => true);
  mockClear.mockClear();
  mockClear.mockImplementation(async () => true);
});

describe("PATCH /api/tenant/resources/[id]", () => {
  it("401s when unauthenticated", async () => {
    const res = await PATCH(patchRequest({ name: "Renamed" }), params);
    expect(res.status).toBe(401);
  });

  it("SETTINGS-1 review: 403s for a member — and never touches slots with the service role", async () => {
    fake.signInAs(MEMBER);
    const res = await PATCH(patchRequest({ active: false }), params);
    expect(res.status).toBe(403);
    expect(fake.calls).toHaveLength(0);
    expect(mockClear).not.toHaveBeenCalled();
    expect(mockRegenerate).not.toHaveBeenCalled();
  });

  it("422s on an invalid capacity", async () => {
    fake.signInAs(OWNER);
    const res = await PATCH(patchRequest({ capacity: -1 }), params);
    expect(res.status).toBe(422);
  });

  it("404s when the resource doesn't belong to the caller's tenant", async () => {
    fake.signInAs(OWNER);
    fake.queue("resources:select", { data: null, error: null });
    const res = await PATCH(patchRequest({ name: "Renamed" }), params);
    expect(res.status).toBe(404);
    expect(fake.callsTo("resources", "update")).toHaveLength(0);
  });

  it("updates a resource scoped to the caller's JWT tenant and regenerates it", async () => {
    fake.signInAs(OWNER);
    fake.queue("resources:select", { data: { id: "r1", metadata: {}, active: true }, error: null });
    fake.queue("resources:update", { data: [{ id: "r1" }], error: null });
    const res = await PATCH(patchRequest({ name: "Renamed", tenant_id: "evil" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, slots_updated: true });
    const update = fake.callsTo("resources", "update")[0];
    expect(update?.payload).toEqual({ name: "Renamed" });
    expect(update?.filters).toContainEqual(["eq", "tenant_id", "t1"]);
    expect(update?.filters).toContainEqual(["eq", "id", "r1"]);
    expect(mockRegenerate).toHaveBeenCalledWith("t1", "r1");
  });

  it("SETTINGS-1 review: 404s (and doesn't regenerate) when RLS matched no row", async () => {
    fake.signInAs(OWNER);
    fake.queue("resources:select", { data: { id: "r1", metadata: {}, active: true }, error: null });
    fake.queue("resources:update", { data: [], error: null });
    const res = await PATCH(patchRequest({ name: "Renamed" }), params);
    expect(res.status).toBe(404);
    expect(mockRegenerate).not.toHaveBeenCalled();
  });

  it("SETTINGS-1: merges slot_minutes into metadata, saves buffer_minutes, and regenerates the resource's slots", async () => {
    fake.signInAs(OWNER);
    fake.queue("resources:select", {
      data: { id: "r1", metadata: { color: "blue" }, active: true },
      error: null,
    });
    fake.queue("resources:update", { data: [{ id: "r1" }], error: null });
    const res = await PATCH(patchRequest({ slot_minutes: 45, buffer_minutes: 15 }), params);
    expect(res.status).toBe(200);
    expect(fake.callsTo("resources", "update")[0]?.payload).toEqual({
      buffer_minutes: 15,
      metadata: { color: "blue", slot_minutes: 45 },
    });
    expect(mockRegenerate).toHaveBeenCalledWith("t1", "r1");
  });

  it("SETTINGS-1: slot_minutes null resets to the default (removes the key)", async () => {
    fake.signInAs(OWNER);
    fake.queue("resources:select", {
      data: { id: "r1", metadata: { slot_minutes: 60 }, active: true },
      error: null,
    });
    fake.queue("resources:update", { data: [{ id: "r1" }], error: null });
    await PATCH(patchRequest({ slot_minutes: null }), params);
    expect(fake.callsTo("resources", "update")[0]?.payload).toEqual({ metadata: {} });
  });

  it("SETTINGS-1: 422s on a slot length under 5 minutes", async () => {
    fake.signInAs(OWNER);
    const res = await PATCH(patchRequest({ slot_minutes: 2 }), params);
    expect(res.status).toBe(422);
  });

  it("reports slots_updated: false when regeneration fails (the nightly roll-forward repairs an active resource)", async () => {
    fake.signInAs(OWNER);
    fake.queue("resources:select", { data: { id: "r1", metadata: {}, active: true }, error: null });
    fake.queue("resources:update", { data: [{ id: "r1" }], error: null });
    mockRegenerate.mockImplementation(async () => false);
    const res = await PATCH(patchRequest({ buffer_minutes: 10 }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, slots_updated: false });
  });

  it("SETTINGS-1: deactivating clears the resource's future slots instead of regenerating", async () => {
    fake.signInAs(OWNER);
    fake.queue("resources:select", { data: { id: "r1", metadata: {}, active: true }, error: null });
    fake.queue("resources:update", { data: [{ id: "r1" }], error: null });
    const res = await PATCH(patchRequest({ active: false }), params);
    expect(res.status).toBe(200);
    expect(mockClear).toHaveBeenCalledWith("t1", "r1");
    expect(mockRegenerate).not.toHaveBeenCalled();
  });

  it("SETTINGS-1 review: deactivation whose slot clear fails changes nothing and 502s (retryable)", async () => {
    fake.signInAs(OWNER);
    fake.queue("resources:select", { data: { id: "r1", metadata: {}, active: true }, error: null });
    mockClear.mockImplementation(async () => false);
    const res = await PATCH(patchRequest({ active: false }), params);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "slots_not_cleared" });
    expect(fake.callsTo("resources", "update")).toHaveLength(0);
  });
});

describe("DELETE /api/tenant/resources/[id]", () => {
  it("401s when unauthenticated", async () => {
    const res = await DELETE(deleteRequest(), params);
    expect(res.status).toBe(401);
  });

  it("SETTINGS-1 review: 403s for a member — no service-role slot wipe behind RLS's back", async () => {
    fake.signInAs(MEMBER);
    const res = await DELETE(deleteRequest(), params);
    expect(res.status).toBe(403);
    expect(mockClear).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
  });

  it("404s for another tenant's resource without clearing anything", async () => {
    fake.signInAs(OWNER);
    fake.queue("resources:select", { data: null, error: null });
    const res = await DELETE(deleteRequest(), params);
    expect(res.status).toBe(404);
    expect(mockClear).not.toHaveBeenCalled();
  });

  it("clears future slots, then soft-deletes (deactivates) rather than hard-deleting", async () => {
    fake.signInAs(OWNER);
    fake.queue("resources:select", { data: { id: "r1" }, error: null });
    fake.queue("resources:update", { data: [{ id: "r1" }], error: null });
    const res = await DELETE(deleteRequest(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, slots_updated: true });
    expect(mockClear).toHaveBeenCalledWith("t1", "r1");
    const update = fake.callsTo("resources", "update")[0];
    expect(update?.payload).toEqual({ active: false });
    expect(update?.filters).toContainEqual(["eq", "tenant_id", "t1"]);
    expect(fake.callsTo("resources", "delete")).toHaveLength(0);
  });

  it("SETTINGS-1 review: 502s and leaves the resource active when its slots can't be cleared", async () => {
    fake.signInAs(OWNER);
    fake.queue("resources:select", { data: { id: "r1" }, error: null });
    mockClear.mockImplementation(async () => false);
    const res = await DELETE(deleteRequest(), params);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "slots_not_cleared" });
    expect(fake.callsTo("resources", "update")).toHaveLength(0);
  });
});
