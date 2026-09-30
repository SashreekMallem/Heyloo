import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, MEMBER, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

const { POST } = await import("./route");

const url = "/api/tenant/agent/vertical-details";
const validPayload = {
  cancellation_policy: { window_hours: 24, text: "24-hour notice required" },
};

function overridesOf(payload: unknown) {
  return (payload as { dynamic_variable_overrides: unknown }).dynamic_variable_overrides;
}

/** Existing overrides row, then a successful update, then the best-effort tenants touch. */
function queueSave(existing: Record<string, unknown>) {
  fake.queue("agent_configs:select", {
    data: { dynamic_variable_overrides: existing },
    error: null,
  });
  fake.queue("agent_configs:update", { data: [{ tenant_id: "t1" }], error: null });
  fake.queue("tenants:update", { data: [{ id: "t1" }], error: null });
}

beforeEach(() => fake.reset());

describe("POST /api/tenant/agent/vertical-details", () => {
  it("401s when unauthenticated", async () => {
    expect((await POST(jsonRequest(url, validPayload))).status).toBe(401);
  });

  it("403s when the caller has no tenant_id claim", async () => {
    fake.signInAs({});
    expect((await POST(jsonRequest(url, validPayload))).status).toBe(403);
  });

  it("QA-1 SEC-07: 403s a member and writes nothing", async () => {
    fake.signInAs(MEMBER);
    const res = await POST(jsonRequest(url, validPayload));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_or_admin_required" });
    expect(fake.callsTo("agent_configs", "update")).toHaveLength(0);
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
  });

  it("QA-1 SEC-07: a write RLS filtered to zero rows is a 404, not {ok:true}", async () => {
    fake.signInAs(OWNER);
    fake.queue("agent_configs:select", { data: { dynamic_variable_overrides: {} }, error: null });
    fake.queue("agent_configs:update", { data: [], error: null });
    expect((await POST(jsonRequest(url, validPayload))).status).toBe(404);
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
  });

  it("422s on a payload that fails verticalDetailsSchema", async () => {
    fake.signInAs(OWNER);
    const res = await POST(
      jsonRequest(url, { cancellation_policy: { window_hours: -1, text: "x" } }),
    );
    expect(res.status).toBe(422);
  });

  it("merges the new fields into the existing dynamic_variable_overrides, scoped to the caller's own tenant_id", async () => {
    fake.signInAs(OWNER);
    queueSave({ manager_name: "Sam" });
    const res = await POST(jsonRequest(url, validPayload));
    expect(res.status).toBe(200);
    const update = fake.callsTo("agent_configs", "update")[0];
    expect(update?.filters).toContainEqual(["eq", "tenant_id", "t1"]);
    expect(overridesOf(update?.payload)).toEqual({
      manager_name: "Sam",
      cancellation_policy: validPayload.cancellation_policy,
    });
    // cancellation_policy.text is non-empty — the route touches
    // tenants.policies_reviewed_at as a real, timestamped acknowledgment.
    expect(fake.callsTo("tenants", "update")[0]?.payload).toHaveProperty("policies_reviewed_at");
  });

  it("SETTINGS-1: normalizes the tow partner phone to E.164 and deletes fields cleared with null", async () => {
    fake.signInAs(OWNER);
    queueSave({ manager_name: "Sam", menu_text: "old menu" });
    const res = await POST(
      jsonRequest(url, {
        ...validPayload,
        tow_partner: { name: "Ace Towing", phone: "(610) 555-0199" },
        menu_text: null,
      }),
    );
    expect(res.status).toBe(200);
    expect(overridesOf(fake.callsTo("agent_configs", "update")[0]?.payload)).toEqual({
      manager_name: "Sam",
      cancellation_policy: validPayload.cancellation_policy,
      tow_partner: { name: "Ace Towing", phone: "+16105550199" },
    });
  });

  it("SETTINGS-1 review: an untouched (empty) tow partner arrives as {} — saves and clears instead of 422ing the whole form", async () => {
    fake.signInAs(OWNER);
    queueSave({});
    const res = await POST(jsonRequest(url, { ...validPayload, tow_partner: {} }));
    expect(res.status).toBe(200);
    expect(overridesOf(fake.callsTo("agent_configs", "update")[0]?.payload)).toEqual({
      cancellation_policy: validPayload.cancellation_policy,
    });
  });

  it("SETTINGS-1: 422s on a tow partner phone that isn't a real number", async () => {
    fake.signInAs(OWNER);
    const res = await POST(
      jsonRequest(url, { ...validPayload, tow_partner: { name: "Ace", phone: "call us" } }),
    );
    expect(res.status).toBe(422);
  });

  it("500s when the update fails", async () => {
    fake.signInAs(OWNER);
    fake.queue("agent_configs:select", { data: { dynamic_variable_overrides: {} }, error: null });
    fake.queue("agent_configs:update", { data: null, error: { message: "db down" } });
    expect((await POST(jsonRequest(url, validPayload))).status).toBe(500);
  });
});
