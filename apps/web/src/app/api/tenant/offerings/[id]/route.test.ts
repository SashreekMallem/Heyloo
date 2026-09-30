import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, MEMBER, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

const { PATCH, DELETE } = await import("./route");

const params = { params: Promise.resolve({ id: "o1" }) };
const url = "/api/tenant/offerings/o1";
const del = () => new Request(`http://localhost${url}`, { method: "DELETE" });

beforeEach(() => fake.reset());

describe("PATCH /api/tenant/offerings/[id]", () => {
  it("401s when unauthenticated", async () => {
    expect((await PATCH(jsonRequest(url, { name: "Renamed" }, "PATCH"), params)).status).toBe(401);
  });

  it("QA-1 SEC-07: 403s a member (RLS would silently drop the write) and never updates", async () => {
    fake.signInAs(MEMBER);
    const res = await PATCH(jsonRequest(url, { price_cents: 7501 }, "PATCH"), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_or_admin_required" });
    expect(fake.callsTo("offerings", "update")).toHaveLength(0);
  });

  it("404s when no row was written (not the caller's tenant / filtered by RLS)", async () => {
    fake.signInAs(OWNER);
    fake.queue("offerings:update", { data: [], error: null });
    expect((await PATCH(jsonRequest(url, { name: "Renamed" }, "PATCH"), params)).status).toBe(404);
  });

  it("422s an invalid body", async () => {
    fake.signInAs(OWNER);
    expect((await PATCH(jsonRequest(url, { price_cents: -5 }, "PATCH"), params)).status).toBe(422);
  });

  it("updates an offering scoped to the caller's tenant", async () => {
    fake.signInAs(OWNER);
    fake.queue("offerings:update", { data: [{ id: "o1" }], error: null });
    const res = await PATCH(jsonRequest(url, { name: "Renamed" }, "PATCH"), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const update = fake.callsTo("offerings", "update")[0];
    expect(update?.filters).toContainEqual(["eq", "tenant_id", "t1"]);
    expect(update?.filters).toContainEqual(["eq", "id", "o1"]);
  });

  it("accepts null to clear a price and duration", async () => {
    fake.signInAs(OWNER);
    fake.queue("offerings:update", { data: [{ id: "o1" }], error: null });
    const res = await PATCH(
      jsonRequest(url, { price_cents: null, duration_minutes: null }, "PATCH"),
      params,
    );
    expect(res.status).toBe(200);
    expect(fake.callsTo("offerings", "update")[0]?.payload).toEqual({
      price_cents: null,
      duration_minutes: null,
    });
  });
});

describe("DELETE /api/tenant/offerings/[id]", () => {
  it("QA-1 SEC-07: 403s a member and never deactivates", async () => {
    fake.signInAs(MEMBER);
    expect((await DELETE(del(), params)).status).toBe(403);
    expect(fake.callsTo("offerings", "update")).toHaveLength(0);
  });

  it("404s when nothing was deactivated", async () => {
    fake.signInAs(OWNER);
    fake.queue("offerings:update", { data: [], error: null });
    expect((await DELETE(del(), params)).status).toBe(404);
  });

  it("soft-deletes (deactivates) rather than hard-deleting", async () => {
    fake.signInAs(OWNER);
    fake.queue("offerings:update", { data: [{ id: "o1" }], error: null });
    const res = await DELETE(del(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fake.callsTo("offerings", "update")[0]?.payload).toEqual({ active: false });
    expect(fake.callsTo("offerings", "delete")).toHaveLength(0);
  });
});
