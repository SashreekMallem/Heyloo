import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, MEMBER, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

const { POST } = await import("./route");

const url = "/api/tenant/agent/instructions";

beforeEach(() => fake.reset());

describe("POST /api/tenant/agent/instructions", () => {
  it("401s signed out, 403s for a member", async () => {
    expect((await POST(jsonRequest(url, {}))).status).toBe(401);
    fake.signInAs(MEMBER);
    expect((await POST(jsonRequest(url, {}))).status).toBe(403);
  });

  it("422s on a partial transfer number", async () => {
    fake.signInAs(OWNER);
    const res = await POST(jsonRequest(url, { transfer_number: "610-555" }));
    expect(res.status).toBe(422);
  });

  it("normalizes the transfer number, merges owned override keys, keeps sibling keys", async () => {
    fake.signInAs(OWNER);
    fake.queue("agent_configs:select", {
      data: {
        dynamic_variable_overrides: {
          cancellation_policy: { window_hours: 24, text: "x" },
          manager_name: "Old Manager",
          delivery: { sms_enabled: true, email_enabled: true },
        },
      },
      error: null,
    });
    fake.queue("agent_configs:update", { data: [{ id: "ac1" }], error: null });
    const res = await POST(
      jsonRequest(url, {
        special_instructions: "Ask whether the car is driveable.",
        transfer_number: "(610) 555-0122",
        voicemail_message: "",
        manager_name: "",
        manager_phone: "610 555 0133",
        parking_info: "Lot behind the shop",
        accessibility_notes: "",
        accepted_payment_types: ["Cash", "Card"],
        call_routing: {
          transfer_window: "business_hours",
          transfer_urgent: true,
          after_hours_phone: "",
        },
      }),
    );
    expect(res.status).toBe(200);
    const update = fake.callsTo("agent_configs", "update")[0];
    expect(update?.filters).toContainEqual(["eq", "tenant_id", "t1"]);
    expect(update?.payload).toEqual({
      special_instructions: "Ask whether the car is driveable.",
      transfer_number: "+16105550122",
      dynamic_variable_overrides: {
        cancellation_policy: { window_hours: 24, text: "x" },
        delivery: { sms_enabled: true, email_enabled: true },
        manager_phone: "+16105550133",
        parking_info: "Lot behind the shop",
        accepted_payment_types: ["Cash", "Card"],
        call_routing: { transfer_window: "business_hours", transfer_urgent: true },
      },
    });
  });

  it("clears a saved transfer number when sent blank", async () => {
    fake.signInAs(OWNER);
    fake.queue("agent_configs:select", { data: { dynamic_variable_overrides: {} }, error: null });
    fake.queue("agent_configs:update", { data: [{ id: "ac1" }], error: null });
    const res = await POST(jsonRequest(url, { transfer_number: "" }));
    expect(res.status).toBe(200);
    expect(fake.callsTo("agent_configs", "update")[0]?.payload).toMatchObject({
      transfer_number: null,
    });
  });

  it("404s when the tenant has no agent config", async () => {
    fake.signInAs(OWNER);
    fake.queue("agent_configs:select", { data: null, error: null });
    expect((await POST(jsonRequest(url, { transfer_number: "" }))).status).toBe(404);
  });
});
